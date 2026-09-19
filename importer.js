const FILE_ALIASES = {
  blocked: ['blocked_profiles.json'],
  closeFriends: ['close_friends.json'],
  customLists: ['custom_lists.json'],
  pendingRequests: ["follow_requests_you've_received.json"],
  followers: ['followers_1.json'],
  following: ['following.json'],
  hideStory: ['hide_story_from.json'],
  favorites: ["profiles_you've_favorited.json"],
  recentFollowRequests: ['recent_follow_requests.json'],
  recentlyUnfollowed: ['recently_unfollowed_profiles.json'],
  restricted: ['restricted_profiles.json'],
};

const REQUIRED_FILES = Object.values(FILE_ALIASES).flat();
const REQUIRED_CORE = new Set(['followers_1.json', 'following.json']);
const TARGET_DIR = 'connections/followers_and_following/';

function normalizedZipPath(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}
function basename(path) { const p = normalizedZipPath(path); return p.slice(p.lastIndexOf('/') + 1); }
function stem(name) { return String(name || '').replace(/\.json$/i, '').replace(/_\d+$/, '').toLowerCase(); }

function cleanUsername(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s || s.length > 200) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const path = u.pathname.split('/').filter(Boolean);
      s = path.at(-1) || '';
    } catch { return null; }
  }
  s = s.replace(/^@/, '').trim();
  return s || null;
}

function isUsernameLike(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,150}$/.test(value.trim());
}

function timestampOf(node) {
  if (!node || typeof node !== 'object') return null;
  const candidates = [node.timestamp, node.time, node.created_timestamp];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const list = node.string_list_data;
  if (Array.isArray(list)) {
    for (const item of list) {
      const n = Number(item?.timestamp);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function recordsFromJson(root) {
  if (root == null) return [];
  const out = [];
  const seen = new WeakSet();
  const visit = (node) => {
    if (node == null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }

    let username = null;
    let timestamp = timestampOf(node);
    const list = Array.isArray(node.string_list_data) ? node.string_list_data : null;
    if (list) {
      const item = list.find(x => x && (x.value || x.href || x.title));
      username = cleanUsername(item?.value || item?.title || item?.href);
      timestamp = timestamp ?? timestampOf(item);
    }
    if (!username && typeof node.value === 'string' && isUsernameLike(node.value)) username = cleanUsername(node.value);
    if (!username && typeof node.title === 'string' && isUsernameLike(node.title)) username = cleanUsername(node.title);
    if (username) out.push({ username, timestamp });

    for (const [key, value] of Object.entries(node)) {
      if (key === 'string_list_data' || key === 'media_list_data') continue;
      visit(value);
    }
  };
  visit(root);

  const dedup = new Map();
  for (const r of out) {
    if (!r.username) continue;
    const old = dedup.get(r.username);
    if (!old || (r.timestamp ?? 0) > (old.timestamp ?? 0)) dedup.set(r.username, r);
  }
  return [...dedup.values()];
}

function findEntry(entries, requestedName) {
  const target = normalizedZipPath(`${TARGET_DIR}${requestedName}`).toLowerCase();
  const exact = entries.find(e => !e.dir && normalizedZipPath(e.name).toLowerCase().endsWith(target));
  if (exact) return exact;

  const requestedStem = stem(requestedName);
  const candidates = entries.filter(e => {
    if (!e || e.dir) return false;
    const path = normalizedZipPath(e.name);
    if (!path.toLowerCase().includes(TARGET_DIR.toLowerCase())) return false;
    return stem(basename(path)) === requestedStem;
  });
  return candidates[0] ?? null;
}

function buildPeople(raw) {
  const people = new Map();
  const ensure = (username) => {
    if (!username) return null;
    if (!people.has(username)) people.set(username, {
      username, followerTimestamp:null, followingTimestamp:null,
      closeFriendTimestamp:null, closeFriend:false, pendingRequestTimestamp:null,
      blocked:false, blockTimestamp:null, restricted:false, restrictedTimestamp:null,
      hideStory:false, hideStoryTimestamp:null, favorite:false,
      recentFollowRequest:false, recentFollowRequestTimestamp:null,
      recentlyUnfollowedTimestamp:null, customLists:[]
    });
    return people.get(username);
  };
  const setAll = (records, fn) => (Array.isArray(records) ? records : []).forEach(r => { const p = ensure(r.username); if (p) fn(p, r); });
  setAll(raw.followers, (p,r)=>p.followerTimestamp=r.timestamp??null);
  setAll(raw.following, (p,r)=>p.followingTimestamp=r.timestamp??null);
  setAll(raw.closeFriends, (p,r)=>{p.closeFriendTimestamp=r.timestamp??null;p.closeFriend=true;});
  setAll(raw.pendingRequests, (p,r)=>p.pendingRequestTimestamp=r.timestamp??null);
  setAll(raw.blocked, (p,r)=>{p.blocked=true;p.blockTimestamp=r.timestamp??null;});
  setAll(raw.restricted, (p,r)=>{p.restricted=true;p.restrictedTimestamp=r.timestamp??null;});
  setAll(raw.hideStory, (p,r)=>{p.hideStory=true;p.hideStoryTimestamp=r.timestamp??null;});
  setAll(raw.favorites, (p)=>p.favorite=true);
  setAll(raw.recentFollowRequests, (p,r)=>{p.recentFollowRequest=true;p.recentFollowRequestTimestamp=r.timestamp??null;});
  setAll(raw.recentlyUnfollowed, (p,r)=>p.recentlyUnfollowedTimestamp=r.timestamp??null);
  (Array.isArray(raw.customLists) ? raw.customLists : []).forEach(r=>{
    const p=ensure(r.username); if(p && !p.customLists.includes(r.listName||'custom_list')) p.customLists.push(r.listName||'custom_list');
  });
  return [...people.values()];
}

export async function loadInstagramArchive(file) {
  if (!file || typeof file.name !== 'string') throw new Error('선택된 ZIP 파일을 찾지 못했습니다.');
  if (!/\.zip$/i.test(file.name)) throw new Error('Instagram ZIP 파일(.zip)을 선택해주세요.');

  const JSZip = globalThis.JSZip;
  if (!JSZip || typeof JSZip.loadAsync !== 'function') throw new Error('ZIP 라이브러리(JSZip)를 불러오지 못했습니다. 페이지를 새로고침하고 다시 시도해주세요.');

  let zip;
  try { zip = await JSZip.loadAsync(file); }
  catch (error) { throw new Error(`ZIP 파일을 열 수 없습니다: ${error?.message || error}`); }

  const entries = Object.values(zip?.files || {});
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP 안에서 파일을 찾지 못했습니다.');

  const resolved = new Map();
  const missing = [];
  for (const fileName of REQUIRED_FILES) {
    const entry = findEntry(entries, fileName);
    if (entry) resolved.set(fileName, entry); else missing.push(fileName);
  }
  const missingCore = missing.filter(x => REQUIRED_CORE.has(x));
  if (missingCore.length) throw new Error(`필수 관계 파일이 없습니다.\n${missingCore.join('\n')}\n\nZIP 내부 파일 경로를 확인해주세요.`);

  const parseJson = async (fileName) => {
    const entry = resolved.get(fileName);
    if (!entry) return null;
    const text = await entry.async('text');
    try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error(`${fileName}: JSON parse failed · ${error.message}`); }
  };

  const parsed = {};
  for (const fileName of REQUIRED_FILES) parsed[fileName] = await parseJson(fileName);
  const raw = {
    followers: recordsFromJson(parsed['followers_1.json']),
    following: recordsFromJson(parsed['following.json']),
    closeFriends: recordsFromJson(parsed['close_friends.json']),
    customLists: recordsFromJson(parsed['custom_lists.json']),
    pendingRequests: recordsFromJson(parsed["follow_requests_you've_received.json"]),
    blocked: recordsFromJson(parsed['blocked_profiles.json']),
    hideStory: recordsFromJson(parsed['hide_story_from.json']),
    favorites: recordsFromJson(parsed["profiles_you've_favorited.json"]),
    recentFollowRequests: recordsFromJson(parsed['recent_follow_requests.json']),
    recentlyUnfollowed: recordsFromJson(parsed['recently_unfollowed_profiles.json']),
    restricted: recordsFromJson(parsed['restricted_profiles.json'])
  };

  if (!raw.followers.length && !raw.following.length) throw new Error('followers/following 데이터를 읽었지만 계정 레코드를 찾지 못했습니다. Instagram export ZIP인지 확인해주세요.');

  const people = buildPeople(raw);
  const events = [];
  for (const r of raw.recentlyUnfollowed) if (r.timestamp) events.push({type:'UNFOLLOW',username:r.username,timestamp:r.timestamp});
  for (const r of raw.blocked) if (r.timestamp) events.push({type:'BLOCK',username:r.username,timestamp:r.timestamp});
  for (const r of raw.recentFollowRequests) if (r.timestamp) events.push({type:'FOLLOW_REQUEST',username:r.username,timestamp:r.timestamp});
  for (const r of raw.closeFriends) if (r.timestamp) events.push({type:'CLOSE_FRIEND_ADD',username:r.username,timestamp:r.timestamp});

  const source = {};
  for (const fileName of REQUIRED_FILES) source[fileName] = resolved.get(fileName)?.name ?? null;
  const loadedFiles = REQUIRED_FILES.filter(f => Boolean(resolved.get(f)));
  const counts = Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v.length:0]));
  const timestamps = [
    ...Object.values(raw).flatMap(records => (Array.isArray(records) ? records : []).map(r => r?.timestamp).filter(Number.isFinite)),
    ...events.map(e => e.timestamp).filter(Number.isFinite)
  ];

  return {
    source:{fileName:file.name, folder:TARGET_DIR, loadedFiles, missingOptional:missing.filter(x=>!REQUIRED_CORE.has(x)), paths:source, loadedAt:new Date().toISOString()},
    people,
    events:events.sort((a,b)=>a.timestamp-b.timestamp),
    recentlyUnfollowed:raw.recentlyUnfollowed,
    diagnostics:{counts,people:people.length,missing,range:{min:timestamps.length?Math.min(...timestamps):null,max:timestamps.length?Math.max(...timestamps):null},zipEntries:entries.length}
  };
}

export { REQUIRED_FILES, TARGET_DIR };
