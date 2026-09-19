import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadInstagramArchive, REQUIRED_FILES } from './importer.js';

const CONFIG={
  fallbackMinDate:new Date('2017-01-01T00:00:00+09:00'),
  fallbackMaxDate:new Date('2026-09-19T18:57:00+09:00'),
  radii:{1:110,2:220,3:350,4:485},
  colors:{1:0xf2a7ff,2:0x8ca8ff,3:0x77e0c1,4:0xb1bacb,me:0xffffff,restricted:0xf4a261,hide:0xff79b1},
  motion:{spawn:620,move:720,exit:520},
  basePlayDurationSeconds:18,
};
const state={data:null,timelineMs:CONFIG.fallbackMaxDate.getTime(),scene:null,camera:null,renderer:null,controls:null,world:null,nodeGroup:null,shellGroup:null,nodes:new Map(),selected:null,playing:false,playbackRate:1,range:{min:CONFIG.fallbackMinDate.getTime(),max:CONFIG.fallbackMaxDate.getTime()},lastFrame:performance.now()};
const $=id=>document.getElementById(id);
const clamp01=x=>Math.min(1,Math.max(0,x));
const easeOut=x=>1-Math.pow(1-clamp01(x),3);
const easeInOut=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
function fmt(date,time=true){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(time?{hour:'2-digit',minute:'2-digit'}:{}),hour12:false}).format(date)}
function fmtShort(ts){return fmt(new Date(ts*1000),false).replace(/\. /g,'-').replace(/\.$/,'')}
function activeAt(ts,t){return ts!=null&&ts*1000<=t}
function rangeSpan(){return Math.max(1,state.range.max-state.range.min)}
function timelineRatio(ts){return clamp01((ts-state.range.min)/rangeSpan())}
function tsFromInput(v){const t=Number(v)/1000;return Math.round(state.range.min+rangeSpan()*t)}
function deriveState(p,t){
  const follower=activeAt(p.followerTimestamp,t);
  const unfollowAt=p.recentlyUnfollowedTimestamp? p.recentlyUnfollowedTimestamp*1000:null;
  const following=activeAt(p.followingTimestamp,t)&&!(unfollowAt&&t>=unfollowAt);
  const closeFriend=p.closeFriend && (p.closeFriendTimestamp==null||activeAt(p.closeFriendTimestamp,t));
  const pending=activeAt(p.pendingRequestTimestamp,t)&&!follower&&!following;
  const blocked=p.blocked&&(p.blockTimestamp==null||activeAt(p.blockTimestamp,t));
  const restricted=p.restricted&&(p.restrictedTimestamp==null||activeAt(p.restrictedTimestamp,t));
  const hideStory=p.hideStory&&(p.hideStoryTimestamp==null||activeAt(p.hideStoryTimestamp,t));
  let orbit=null;
  if(!blocked){if(closeFriend)orbit=1;else if(follower&&following)orbit=2;else if(follower||following)orbit=3;else if(pending)orbit=4;}
  let direction='none';
  if(orbit===1||orbit===2)direction='mutual';
  else if(orbit===3)direction=following&&!follower?'outgoing':'incoming';
  else if(orbit===4)direction='pending';
  return {...p,follower,following,closeFriend,pending,restricted,hideStory,blocked,orbit,direction};
}
function visibleStates(t){return state.data?.people?.map(p=>deriveState(p,t)).filter(p=>p.orbit!==null)??[]}
function fibonacciSphere(count,radius,phase=0){if(count<=0)return[];if(count===1)return[new THREE.Vector3(0,radius,0)];const out=[],golden=Math.PI*(3-Math.sqrt(5));for(let i=0;i<count;i++){const y=1-(i/(count-1))*2,ring=Math.sqrt(Math.max(0,1-y*y)),theta=golden*i+phase;out.push(new THREE.Vector3(Math.cos(theta)*ring*radius,y*radius,Math.sin(theta)*ring*radius))}return out}
function layoutVisible(list){const grouped=new Map([1,2,3,4].map(o=>[o,[]]));for(const p of list)grouped.get(p.orbit).push(p);for(const arr of grouped.values())arr.sort((a,b)=>a.username.localeCompare(b.username));const targets=new Map();for(const orbit of [1,2,3,4]){const people=grouped.get(orbit),points=fibonacciSphere(people.length,CONFIG.radii[orbit],orbit*.73);people.forEach((p,i)=>targets.set(p.username,points[i]))}return targets}
function setOpacity(node,o){const v=node.userData.visuals;if(!v)return;const t=node.userData.visualTarget||{};v.sphere.material.opacity=o;v.closeRing.material.opacity=(t.closeOpacity??0)*o;v.cfBadge.material.opacity=(t.cfOpacity??0)*o;v.restrictedRing.material.opacity=(t.restrictedOpacity??0)*o;v.hideMarker.material.opacity=(t.hideOpacity??0)*o}
function makeTextSprite(text,color='#f2a7ff'){const c=document.createElement('canvas');c.width=96;c.height=48;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(9,10,16,.88)';ctx.beginPath();ctx.roundRect(4,7,88,34,17);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=color;ctx.font='700 19px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,48,24);const texture=new THREE.CanvasTexture(c);texture.needsUpdate=true;const m=new THREE.SpriteMaterial({map:texture,transparent:true,opacity:0,depthWrite:false});const s=new THREE.Sprite(m);s.scale.set(36,18,1);s.position.set(0,23,0);return s}
function makeNode(person,pos){const g=new THREE.Group();g.position.copy(pos);g.userData.person=person;g.userData.targetPosition=pos.clone();const sphere=new THREE.Mesh(new THREE.SphereGeometry(5.3,12,12),new THREE.MeshBasicMaterial({color:CONFIG.colors[person.orbit],transparent:true,opacity:1}));sphere.userData.person=person;g.add(sphere);const closeRing=new THREE.Mesh(new THREE.TorusGeometry(10.5,.8,8,32),new THREE.MeshBasicMaterial({color:CONFIG.colors[1],transparent:true,opacity:0}));closeRing.rotation.x=Math.PI/2;g.add(closeRing);const cfBadge=makeTextSprite('CF','#f2a7ff');g.add(cfBadge);const restrictedRing=new THREE.Mesh(new THREE.TorusGeometry(14,.65,8,32),new THREE.MeshBasicMaterial({color:CONFIG.colors.restricted,transparent:true,opacity:0}));restrictedRing.rotation.x=Math.PI/2;g.add(restrictedRing);const hideMarker=new THREE.Mesh(new THREE.OctahedronGeometry(1.8,0),new THREE.MeshBasicMaterial({color:CONFIG.colors.hide,transparent:true,opacity:0}));hideMarker.position.set(12,9,0);g.add(hideMarker);g.userData.visuals={sphere,closeRing,cfBadge,restrictedRing,hideMarker};g.userData.baseScale=({1:1.28,2:1.04,3:.9,4:.8}[person.orbit]??1);g.userData.animOpacity=1;applyVisual(g,person,true);return g}
function applyVisual(node,p,instant=false){node.userData.person=p;node.userData.baseScale=({1:1.28,2:1.04,3:.9,4:.8}[p.orbit]??1);const v=node.userData.visuals;node.userData.visualTarget={color:new THREE.Color(CONFIG.colors[p.orbit]??0xffffff),scale:node.userData.baseScale,closeOpacity:p.closeFriend?.98:0,cfOpacity:p.closeFriend?.1:0,restrictedOpacity:p.restricted?.9:0,hideOpacity:p.hideStory?1:0};if(instant){v.sphere.material.color.copy(node.userData.visualTarget.color);v.closeRing.material.opacity=node.userData.visualTarget.closeOpacity;v.cfBadge.material.opacity=node.userData.visualTarget.cfOpacity;v.restrictedRing.material.opacity=node.userData.visualTarget.restrictedOpacity;v.hideMarker.material.opacity=node.userData.visualTarget.hideOpacity}}
function motionDuration(base){return Math.max(160,base/state.playbackRate)}
function startMotion(node,target,kind='move'){const from=node.position.clone();let to=target.clone(),fromScale=node.userData.animScale??node.userData.baseScale,toScale=node.userData.baseScale,fromOpacity=node.userData.animOpacity??1,toOpacity=1;if(kind==='enter'){from.set(0,0,0);fromScale=.05;fromOpacity=0}else if(kind==='exit'){const dir=from.clone().normalize();if(dir.lengthSq()<.01)dir.set(1,0,0);to=from.clone().add(dir.normalize().multiplyScalar(170));toScale=.04;toOpacity=0}node.userData.motion={kind,start:from,target:to,startScale:fromScale,targetScale:toScale,startOpacity:fromOpacity,targetOpacity:toOpacity,startedAt:performance.now(),duration:motionDuration(kind==='enter'?CONFIG.motion.spawn:kind==='exit'?CONFIG.motion.exit:CONFIG.motion.move)}}
function disposeNode(node){node.traverse(o=>{if(o.geometry)o.geometry.dispose?.();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{m.map?.dispose?.();m.dispose?.()})}});node.removeFromParent()}
function clearAllNodes(){for(const node of state.nodes.values())disposeNode(node);state.nodes.clear()}
function nearlySame(a,b){return a&&b&&a.distanceTo(b)<.75}
function syncSceneToTime(t,{immediate=false}={}){if(!state.data||!state.nodeGroup)return;const visible=visibleStates(t),targets=layoutVisible(visible),next=new Set(visible.map(p=>p.username));for(const p of visible){const target=targets.get(p.username),node=state.nodes.get(p.username);if(!node){const n=makeNode(p,target);state.nodeGroup.add(n);state.nodes.set(p.username,n);if(!immediate)startMotion(n,target,'enter');continue}const prevOrbit=node.userData.person?.orbit;const targetChanged=!nearlySame(node.userData.targetPosition,target)||prevOrbit!==p.orbit;applyVisual(node,p,false);node.userData.targetPosition=target.clone();if(node.userData.motion?.kind==='exit'){node.userData.motion=null;node.userData.animOpacity=1;node.userData.animScale=node.userData.baseScale;setOpacity(node,1);node.position.copy(node.position)}if(immediate){node.position.copy(target);node.scale.setScalar(node.userData.baseScale);node.userData.animScale=node.userData.baseScale;node.userData.animOpacity=1;setOpacity(node,1);node.userData.motion=null}else if(targetChanged){startMotion(node,target,'move')}}for(const [username,node] of [...state.nodes.entries()]){if(next.has(username))continue;if(node.userData.motion?.kind==='exit')continue;startMotion(node,node.position,'exit')}updateHud(visible);updateTimelineUI()}
function createShell(r,c,o){return new THREE.Mesh(new THREE.SphereGeometry(r,24,16),new THREE.MeshBasicMaterial({color:c,wireframe:true,transparent:true,opacity:o,depthWrite:false}))}
function addStars(){const count=700,pos=new Float32Array(count*3);for(let i=0;i<count;i++){pos[i*3]=(Math.random()-.5)*1700;pos[i*3+1]=(Math.random()-.5)*1100;pos[i*3+2]=(Math.random()-.5)*1700}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));state.scene.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:1.2,transparent:true,opacity:.2,depthWrite:false})))}
function initThree(){const canvas=$('scene'),scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x05060a,.00056);state.scene=scene;const camera=new THREE.PerspectiveCamera(53,1,.1,3000);camera.position.set(0,65,760);state.camera=camera;const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;state.renderer=renderer;const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.085;controls.enablePan=false;controls.rotateSpeed=.46;controls.zoomSpeed=.65;controls.minDistance=320;controls.maxDistance=1350;controls.target.set(0,0,0);state.controls=controls;scene.add(new THREE.AmbientLight(0xffffff,.8));const light=new THREE.PointLight(0x9d86f4,36,1500);light.position.set(-240,160,-260);scene.add(light);state.world=new THREE.Group();scene.add(state.world);const center=new THREE.Group();center.add(new THREE.Mesh(new THREE.SphereGeometry(12,24,24),new THREE.MeshBasicMaterial({color:CONFIG.colors.me,transparent:true,opacity:.92})));const ring=new THREE.Mesh(new THREE.TorusGeometry(19,.75,8,48),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.36}));ring.rotation.x=Math.PI/2;center.add(ring);state.world.add(center);state.nodeGroup=new THREE.Group();state.world.add(state.nodeGroup);state.shellGroup=new THREE.Group();state.shellGroup.add(createShell(CONFIG.radii[1],CONFIG.colors[1],.035),createShell(CONFIG.radii[2],CONFIG.colors[2],.023),createShell(CONFIG.radii[3],CONFIG.colors[3],.015),createShell(CONFIG.radii[4],CONFIG.colors[4],.009));state.world.add(state.shellGroup);addStars();let down=null;canvas.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY,t:performance.now()});canvas.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);const tap=performance.now()-down.t<650;down=null;if(moved<8&&tap)pickNode(e)});window.addEventListener('resize',onResize);onResize();requestAnimationFrame(animate)}
function onResize(){const canvas=$('scene');if(!canvas.clientWidth||!canvas.clientHeight)return;state.camera.aspect=canvas.clientWidth/canvas.clientHeight;state.camera.updateProjectionMatrix();state.renderer.setSize(canvas.clientWidth,canvas.clientHeight,false)}
function pickNode(e){const rect=$('scene').getBoundingClientRect(),p=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height)*2+1),ray=new THREE.Raycaster();ray.setFromCamera(p,state.camera);const meshes=[];state.nodes.forEach(n=>n.traverse(o=>{if(o.isMesh)o.userData.person=n.userData.person,meshes.push(o)}));const hit=ray.intersectObjects(meshes,false)[0];if(hit?.object?.userData?.person){state.selected=hit.object.userData.person;openDetail(state.selected)}}
function detailText(p){if(p.direction==='incoming')return'상대가 나를 팔로우하고 있고, 나는 현재 팔로우하지 않습니다.';if(p.direction==='outgoing')return'내가 상대를 팔로우하고 있고, 상대는 현재 팔로우하지 않습니다.';if(p.direction==='pending')return'현재 활성 관계가 아닌 pending request입니다.';if(p.closeFriend)return'Close Friends로 등록된 관계입니다. Close Friends는 기본 Orbit보다 우선합니다.';if(p.restricted)return'Restricted는 Orbit을 바꾸지 않고 modifier로 표시됩니다.';return'선택한 시간의 관계 상태입니다.'}
function orbitLabel(o){return({1:'01 · Close Friends',2:'02 · Mutual',3:'03 · One-way',4:'04 · Pending'})[o]??'Hidden'}
function fillDetail(kind,p){
  const ids = kind==='mobile' ? {
    username:'detailUsername', orbit:'detailOrbit', follower:'detailFollower', following:'detailFollowing',
    closeFriend:'detailCloseFriend', restricted:'detailRestricted', hideStory:'detailHideStory', pending:'detailPending'
  } : {
    username:'desktopDetailUsername', orbit:'desktopDetailOrbit', follower:'desktopFollower', following:'desktopFollowing',
    closeFriend:'desktopCloseFriend', restricted:'desktopRestricted', hideStory:'desktopHideStory', pending:'desktopPending'
  };
  $(ids.username).textContent='@'+p.username;
  $(ids.orbit).textContent=orbitLabel(p.orbit);
  $(ids.follower).textContent=p.follower?`YES · ${p.followerTimestamp?fmtShort(p.followerTimestamp):'known'}`:'NO';
  $(ids.following).textContent=p.following?`YES · ${p.followingTimestamp?fmtShort(p.followingTimestamp):'known'}`:'NO';
  $(ids.closeFriend).textContent=p.closeFriend?'YES':'NO';
  $(ids.restricted).textContent=p.restricted?'YES':'NO';
  $(ids.hideStory).textContent=p.hideStory?'YES':'NO';
  $(ids.pending).textContent=p.pending?'YES':'NO';
}
function openDetail(p){$('detailPanel').classList.remove('hidden');fillDetail('mobile',p);$('detailNote').textContent=detailText(p);$('emptyDetail').classList.add('hidden');$('desktopDetail').classList.remove('hidden');fillDetail('desktop',p);$('desktopNote').textContent=detailText(p)}
function closeDetail(){state.selected=null;$('detailPanel').classList.add('hidden');$('emptyDetail').classList.remove('hidden');$('desktopDetail').classList.add('hidden')}
function updateHud(visible){const counts=[1,2,3,4].map(o=>visible.filter(p=>p.orbit===o).length);counts.forEach((c,i)=>{$('countOrbit'+(i+1)).textContent=c;$('sideOrbit'+(i+1)).textContent=c});$('stateMeta').textContent=`${visible.length} active · ${fmt(new Date(state.timelineMs))}`;$('dateLabel').textContent=fmt(new Date(state.timelineMs),false);$('timelineTitle').textContent=fmt(new Date(state.timelineMs));$('stateLabel').textContent=Math.abs(state.timelineMs-state.range.max)<3600000?'LATEST DATA':'HISTORICAL'}
function updateTimelineUI(){$('timeline').value=String(Math.round(timelineRatio(state.timelineMs)*1000))}
function renderTime(ts,immediate=false){state.timelineMs=THREE.MathUtils.clamp(ts,state.range.min,state.range.max);syncSceneToTime(state.timelineMs,{immediate})}
function setupTimeline(){
  const slider=$('timeline');
  slider.addEventListener('input',()=>renderTime(tsFromInput(slider.value)));
  $('currentTimeline').addEventListener('click',()=>renderTime(state.range.max));
  $('playTimeline').addEventListener('click',()=>{state.playing=!state.playing;$('playTimeline').textContent=state.playing?'Ⅱ':'▶'});
  document.querySelectorAll('.speed-group button').forEach(btn=>btn.addEventListener('click',()=>{state.playbackRate=Number(btn.dataset.speed);document.querySelectorAll('.speed-group button').forEach(b=>b.classList.toggle('active',b===btn))}));
  $('resetView').addEventListener('click',()=>{state.controls.reset();state.camera.position.set(0,65,760)});
  $('closeDetail').addEventListener('click',closeDetail);
}
function buildTimelineLabels(){
  const startYear=new Date(state.range.min).getFullYear();
  const endYear=new Date(state.range.max).getFullYear();
  const span=Math.max(0,endYear-startYear);
  const step=Math.max(1,Math.ceil(span/6));
  const years=[];
  for(let y=startYear;y<=endYear;y+=step) years.push(y);
  if(years.at(-1)!==endYear) years.push(endYear);
  $('yearLabels').innerHTML=state.data ? years.map(y=>`<span>${y}</span>`).join('') : '<span>데이터 없음</span>';
  $('timeline').disabled=!state.data;
}
function setupEvents(){const track=$('eventTrack');const events=state.data?.events??[];track.innerHTML=events.map(e=>{const p=timelineRatio(e.timestamp*1000);if(p<0||p>1)return'';return`<span class="event-mark" style="left:${(p*100).toFixed(3)}%" title="${e.type} · @${e.username}"></span>`}).join('')}
function updateMetrics(){const people=state.data?.people??[];const followers=people.filter(p=>p.followerTimestamp!=null).length,following=people.filter(p=>p.followingTimestamp!=null).length,mutual=people.filter(p=>p.followerTimestamp!=null&&p.followingTimestamp!=null).length;$('metricTotal').textContent=people.length.toLocaleString();$('metricFollowers').textContent=followers.toLocaleString();$('metricFollowing').textContent=following.toLocaleString();$('metricMutual').textContent=mutual.toLocaleString();const missing=state.data?.source?.missingOptional??[];const range=state.data?.diagnostics?.range??{};const rangeText=Number.isFinite(range.min)&&Number.isFinite(range.max)?`${fmtShort(range.min)} → ${fmtShort(range.max)}`:'데이터 범위 계산 중';$('coverageLabel').textContent=missing.length?`데이터 범위 ${rangeText} · optional ${missing.length}개 누락`:`데이터 범위 ${rangeText} · known unfollow ${(state.data.recentlyUnfollowed??[]).length}건`;const loaded=state.data?.source?.loadedFiles?.length??0;$('loadedFileStatus').textContent=`${loaded}/${REQUIRED_FILES.length} relation files loaded`}
function updateNodeMotions(now){
  for(const [username,node] of [...state.nodes.entries()]){
    const m=node.userData.motion;
    if(m){
      const r=clamp01((now-m.startedAt)/m.duration);
      const p=m.kind==='exit'?easeOut(r):easeInOut(r);
      node.position.lerpVectors(m.start,m.target,p);
      const s=THREE.MathUtils.lerp(m.startScale,m.targetScale,p);
      const o=THREE.MathUtils.lerp(m.startOpacity,m.targetOpacity,p);
      node.scale.setScalar(s);
      node.userData.animScale=s;
      node.userData.animOpacity=o;
      setOpacity(node,o);
      if(r>=1){
        node.userData.motion=null;
        node.userData.animScale=m.targetScale;
        node.userData.animOpacity=m.targetOpacity;
        setOpacity(node,m.targetOpacity);
        if(m.kind==='exit'){
          state.nodes.delete(username);
          disposeNode(node);
          if(state.selected?.username===username) closeDetail();
          continue;
        }
      }
    }
    const target=node.userData.visualTarget, visuals=node.userData.visuals;
    if(target&&visuals){
      visuals.sphere.material.color.lerp(target.color,.14);
      const a=node.userData.animOpacity??1;
      visuals.closeRing.material.opacity += (target.closeOpacity*a-visuals.closeRing.material.opacity)*.2;
      visuals.cfBadge.material.opacity += (target.cfOpacity*a-visuals.cfBadge.material.opacity)*.2;
      visuals.restrictedRing.material.opacity += (target.restrictedOpacity*a-visuals.restrictedRing.material.opacity)*.2;
      visuals.hideMarker.material.opacity += (target.hideOpacity*a-visuals.hideMarker.material.opacity)*.2;
    }
  }
}
function animate(now=performance.now()){
  requestAnimationFrame(animate);
  const dt=Math.min(.1,(now-state.lastFrame)/1000);
  state.lastFrame=now;
  if(state.playing&&state.data){
    const base=rangeSpan()/CONFIG.basePlayDurationSeconds;
    const next=Math.min(state.timelineMs+base*state.playbackRate*dt,state.range.max);
    renderTime(next);
    if(next>=state.range.max){state.playing=false;$('playTimeline').textContent='▶';}
  }
  updateNodeMotions(now);
  if(state.shellGroup)state.shellGroup.rotation.y+=dt*.025;
  state.controls?.update();
  state.renderer?.render(state.scene,state.camera);
}
async function loadDataFromFile(file){
  $('loading').classList.remove('done');
  $('loading').innerHTML='<div class="loader"></div><div>ZIP 관계 데이터를 읽는 중…</div>';
  try{
    const data=await loadInstagramArchive(file);
    state.data=data;
    state.archiveFileName=file.name;
    const minTs=data?.diagnostics?.range?.min;
    const maxTs=data?.diagnostics?.range?.max;
    if(Number.isFinite(minTs)&&Number.isFinite(maxTs)&&maxTs>=minTs){
      state.range={min:minTs*1000,max:maxTs*1000};
    }else{
      state.range={min:CONFIG.fallbackMinDate.getTime(),max:CONFIG.fallbackMaxDate.getTime()};
    }
    state.timelineMs=state.range.max;
    buildTimelineLabels();
    setupEvents();
    updateMetrics();
    clearAllNodes();
    renderTime(state.range.max,true);
    $('timeline').value='1000';
    $('timelineTitle').textContent=fmt(new Date(state.range.max));
    $('importName').textContent=`${file.name} · ${data.source.loadedFiles.length}/${REQUIRED_FILES.length}`;
    $('importStatus').classList.add('loaded');
    $('importOverlay').classList.add('hidden');
    $('loading').classList.add('done');
  }catch(error){$('loading').classList.add('done');throw error}
}
function setupImporter(){const input=$('archiveInput'),drop=$('dropZone'),overlay=$('importOverlay');const handle=file=>{if(!file)return;$('importError').classList.remove('show');loadDataFromFile(file).catch(error=>{console.error(error);const stack=error?.stack?`\n\n[DEBUG STACK]\n${error.stack}`:'';$('importName').textContent='Import failed';$('importError').textContent=(error?.message??String(error))+stack;$('importError').classList.add('show');overlay.classList.remove('hidden')})};input.addEventListener('change',e=>handle(e.target.files?.[0]));['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('dragging')}));['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('dragging')}));drop.addEventListener('drop',e=>handle(e.dataTransfer?.files?.[0]));$('showImporter').addEventListener('click',()=>overlay.classList.remove('hidden'))}
function boot(){initThree();setupTimeline();setupImporter();buildTimelineLabels();updateTimelineUI()}
boot();
