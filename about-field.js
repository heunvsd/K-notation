// The picture selects the definition. Only the drawn strokes collide.
(() => {
  "use strict";
  const page=document.getElementById("about-page"), viewport=page.querySelector(".ink-viewport");
  if(viewport.querySelector(".ink-stage"))return;
  const articles=[...document.getElementById("ink-symbols").content.querySelectorAll(".about-symbol")];
  const ink=window.KNOTATION_INK;
  if(!window.planck || !window.createKnotWorld || !ink || ink.length!==articles.length) return;

  const ns="http://www.w3.org/2000/svg";
  function svgEl(tag,attrs={}) {
    const el=document.createElementNS(ns,tag);
    for(const [name,value] of Object.entries(attrs)) el.setAttribute(name,value);
    return el;
  }
  const svg=svgEl("svg",{"class":"ink-stage",role:"group","aria-label":"관계 기호 여덟 가지"});
  const meta=articles.map(a=>({name:a.querySelector("h3").textContent,desc:[...a.querySelectorAll("p")].map(p=>p.textContent).join("\n"),
    src:a.dataset.symbolSrc}));
  // Include the empty interiors of a mark, but trim its exported artboard
  // padding. All visible strokes sit above the transparent hit rectangles.
  const bounds=ink.map(shape=>{
    const points=shape.paths.flat();
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  });
  const areaLayer=svgEl("g",{"aria-hidden":"true"});svg.append(areaLayer);
  const areas=bounds.map((box,i)=>{
    const area=svgEl("rect",{class:"ink-area","data-ink":i,x:box.left,y:box.top,
      width:box.right-box.left,height:box.bottom-box.top,visibility:"hidden"});
    areaLayer.append(area);return area;
  });
  const groups=ink.map((shape,i)=>{
    const g=svgEl("g",{class:"ink-piece",role:"button","aria-label":meta[i].name,
      "aria-describedby":'ink-desc-'+i,tabindex:"-1",visibility:"hidden","data-ink":i});
    const desc=svgEl("desc",{id:'ink-desc-'+i,lang:"ko"});desc.textContent=meta[i].desc;
    const local=svgEl("g");
    const img=svgEl("image",{x:-shape.w/2,y:-shape.h/2,width:shape.w,height:shape.h,
      href:meta[i].src,"aria-hidden":"true"});
    const outline=shape.paths.map(points=>"M"+points.map(p=>p.join(",")).join("L")+"Z").join("");
    const hit=svgEl("path",{class:"ink-hit",d:outline,"fill-rule":"evenodd","aria-hidden":"true"});
    local.append(hit);
    local.append(img); g.append(desc,local); svg.append(g); return g;
  });
  const reader=document.createElement("div");
  reader.className="ink-reader";
  reader.lang="ko";
  reader.setAttribute("aria-hidden","true"); // Each focusable mark already exposes the same definition.
  reader.hidden=true;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  let hover=-1,focus=-1,tap=-1,held=-1,shown=-2,pointerId=null;
  let anchor=null, hoverPoint=null, checkedAt=0;
  function positionReader() {
    if(shown<0)return;
    const body=sim?.bodies[shown];
    reader.hidden=!body;
    if(!body)return;
    if(anchor?.index!==shown){
      // Keyboard focus has no pointer. Use the ink nearest the visual centre.
      anchor={index:shown,...sim.nearestInk(shown,body.getWorldCenter())};
    }
    const point=body.getWorldPoint(anchor.local);
    reader.style.setProperty("--ink-x",point.x*ppm+"px");
    reader.style.setProperty("--ink-y",point.y*ppm+"px");
  }
  function describe() {
    const i=held>=0?held:hover>=0?hover:focus>=0?focus:tap;
    if(i===shown){positionReader();return;}
    shown=i;
    reader.hidden=i<0;
    if(i>=0) {
      reader.textContent=meta[i].desc;
      positionReader();
    }
  }
  viewport.tabIndex=0;
  viewport.setAttribute("role","region");
  viewport.setAttribute("aria-label","매듭 기호. Tab으로 기호를 선택하고 방향키로 움직여 보세요.");
  viewport.append(svg,reader);
  let grabStart=null;
  let sim=null, ppm=1, frame=0,last=0,accum=0,lastSize="",preparingStill=false;
  const lastPose=Array(ink.length).fill(null);
  function draw() {
    sim.bodies.forEach((b,i)=>{
      if(!b)return;
      const p=b.getPosition(),g=groups[i];
      const pose=`translate(${p.x.toFixed(4)} ${p.y.toFixed(4)}) rotate(${(b.getAngle()*180/Math.PI).toFixed(3)})`;
      if(pose===lastPose[i])return;
      lastPose[i]=pose;
      g.setAttribute("transform",pose);areas[i].setAttribute("transform",pose+" scale("+sim.sizes[i]+")");
      if(g.getAttribute("visibility")==="hidden"){
        g.removeAttribute("visibility");areas[i].removeAttribute("visibility");g.setAttribute("tabindex","0");
      }
    });
    const now=performance.now();
    if(hoverPoint && pointerId===null && (now-checkedAt>65 || !sim.active())){
      hover=pickAt(hoverPoint,hover);
      checkedAt=now;
      describe();
    }else positionReader();
  }
  function aboutIsOpen(){return !document.hidden && !page.hidden && page.classList.contains("is-visible");}
  function animate(now) {
    frame=0;
    if(!aboutIsOpen() || !sim){last=0;return;}
    if(preparingStill){
      // With reduced motion, compute the physically supported pile while the
      // introduction is being read. Yield between batches and show only its final pose.
      const until=performance.now()+9;
      do {sim.step();} while(sim.active() && performance.now()<until);
      if(sim.active())frame=requestAnimationFrame(animate);
      else {preparingStill=false;draw();}
      return;
    }
    accum+=last?Math.min((now-last)/1000,.055):sim.tick;last=now;
    const deadline=performance.now()+8;
    while(accum>=sim.tick){
      sim.step();
      accum-=sim.tick;
      // On a slow frame let input and paint run before attempting more work.
      if(performance.now()>=deadline){accum%=sim.tick;break;}
    }
    draw();
    if(sim.active()) frame=requestAnimationFrame(animate);
    else {last=0;accum=0;}
  }
  function wake(){if(!frame && sim?.active() && aboutIsOpen()){last=0;frame=requestAnimationFrame(animate);}}
  function stop(){cancelAnimationFrame(frame);frame=last=accum=0;}
  function endHold(id=pointerId,followThrough=false) {
    if(id===null || id!==pointerId)return;
    sim?.release(followThrough);grabStart=null;pointerId=null; held=-1; svg.classList.remove("is-holding");
    if(svg.hasPointerCapture(id))svg.releasePointerCapture(id);
    describe(); wake();
  }
  function setup() {
    if(!aboutIsOpen())return;
    const {width:w,height:h}=svg.getBoundingClientRect();
    const key=Math.round(w)+":"+Math.round(h);
    if(sim && key===lastSize){wake();return;}
    if(!w||!h)return;
    endHold();stop();lastSize=key;
    reader.style.setProperty("--field-width",w+"px");
    reader.style.setProperty("--field-height",h+"px");
    ppm=Math.min(w/(h/w>1.60?19:32),h/18);
    const W=w/ppm,H=h/ppm;
    svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
    sim=window.createKnotWorld(ink,W,H,{immediate:reduced.matches,previous:sim});
    preparingStill=reduced.matches && sim.active();
    anchor=null;hoverPoint=null;hover=-1;describe();
    lastPose.fill(null);
    groups.forEach((g,i)=>{
      g.setAttribute("visibility","hidden");areas[i].setAttribute("visibility","hidden");g.setAttribute("tabindex","-1");
      g.querySelector("g").setAttribute("transform","scale("+sim.sizes[i]+")");
    });
    if(!preparingStill)draw();
    wake();
  }
  function reset() {
    endHold();stop();sim=null;preparingStill=false;lastSize="";anchor=hoverPoint=null;tap=focus=hover=-1;describe();
    groups.forEach((g,i)=>{g.setAttribute("visibility","hidden");areas[i].setAttribute("visibility","hidden");g.setAttribute("tabindex","-1");});
  }
  function updateView() {
    if(page.hidden){
      reset();
    }else if(aboutIsOpen()){
      setup();
    }else{
      endHold();stop();
    }
  }
  new ResizeObserver(updateView).observe(viewport);
  new MutationObserver(updateView).observe(page,{attributes:true,attributeFilter:["hidden","class"]});
  document.addEventListener("visibilitychange",updateView);
  reduced.addEventListener("change",()=>{reset();updateView();});
  updateView();
  function indexOf(el){const g=el?.closest?.(".ink-piece");return g?Number(g.dataset.ink):-1;}
  function point(e){const r=svg.getBoundingClientRect();return [(e.clientX-r.left)/ppm,(e.clientY-r.top)/ppm];}
  function pickAt([x,y], previous) {
    if(!sim)return -1;
    const pointer={x,y}, tolerance=6/ppm;
    let closest=null, incumbent=null;
    sim.bodies.forEach((body,i)=>{
      if(!body)return;
      const p=body.getLocalPoint(pointer), scale=sim.sizes[i], b=bounds[i];
      if(p.x<b.left*scale-tolerance || p.x>b.right*scale+tolerance ||
         p.y<b.top*scale-tolerance || p.y>b.bottom*scale+tolerance)return;
      const candidate={index:i,...sim.nearestInk(i,pointer)};
      if(!closest || candidate.distance<closest.distance)closest=candidate;
      if(i===previous)incumbent=candidate;
    });
    if(!closest)return -1;
    // A direct stroke hit wins. In a shared hollow, resist flicker when
    // the nearest two lines are only a few pixels apart.
    if(closest.distance>2/ppm && incumbent && incumbent.distance<closest.distance+3/ppm)closest=incumbent;
    if(anchor?.index===closest.index){
      const old=sim.bodies[closest.index].getWorldPoint(anchor.local);
      if(Math.hypot(x-old.x,y-old.y)<=closest.distance+2/ppm)return closest.index;
    }
    anchor=closest;
    return closest.index;
  }
  function track(e) {
    if(e.pointerType==="touch" || pointerId!==null)return;
    hoverPoint=point(e);
    hover=pickAt(hoverPoint,hover);describe();
  }
  svg.addEventListener("pointerover",track);
  svg.addEventListener("pointerleave",()=>{hoverPoint=null;if(pointerId===null){hover=-1;describe();}});
  svg.addEventListener("pointerdown",e=>{
    if(pointerId!==null || e.button!==0)return;
    hoverPoint=null;
    const i=pickAt(point(e),hover);
    if(i<0){tap=hover=focus=-1;describe();return;}
    // A touch on photo whitespace reads the definition without trapping a
    // vertical swipe. Touching the stroke itself still picks up the mark.
    if(e.pointerType==="touch" && !e.target.matches(".ink-hit")){
      tap=i;focus=hover=-1;describe();return;
    }
    if(!sim?.bodies[i])return;
    e.preventDefault(); focus=-1;tap=e.pointerType==="touch"?i:-1;held=i;pointerId=e.pointerId;
    grabStart={point:point(e),x:e.clientX,y:e.clientY};svg.setPointerCapture(pointerId);describe();
  });
  svg.addEventListener("pointermove",e=>{
    if(e.pointerId!==pointerId){track(e);return;}
    if(grabStart){
      if(Math.hypot(e.clientX-grabStart.x,e.clientY-grabStart.y)<3)return;
      sim.hold(held,...grabStart.point);grabStart=null;svg.classList.add("is-holding");wake();
    }
    sim.move(...point(e));
  });
  svg.addEventListener("pointerup",e=>{
    if(e.pointerId!==pointerId)return;
    hoverPoint=e.pointerType==="touch"?null:point(e);
    hover=hoverPoint?pickAt(hoverPoint,held):-1;
    sim.move(...point(e));endHold(e.pointerId,true);
  });
  svg.addEventListener("pointercancel",e=>{hover=-1;endHold(e.pointerId);});
  svg.addEventListener("lostpointercapture",e=>endHold(e.pointerId));
  window.addEventListener("blur",()=>endHold());
  svg.addEventListener("focusin",e=>{anchor=hoverPoint=null;focus=indexOf(e.target);hover=tap=-1;describe();});
  svg.addEventListener("focusout",()=>{focus=-1;describe();});
  svg.addEventListener("keydown",e=>{
    const i=indexOf(e.target), impulse={ArrowUp:[0,-8],ArrowDown:[0,4],ArrowLeft:[-5,-2],ArrowRight:[5,-2]}[e.key];
    if(i<0)return;
    if(impulse){e.preventDefault();sim?.nudge(i,...impulse);wake();}
    if(e.key==="Enter" || e.key===" "){e.preventDefault();focus=i;describe();}
  });
})();
