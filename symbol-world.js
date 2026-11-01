// Coordinates are metres, with positive y downward. Only the ink has mass.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./vendor/planck-1.4.2.min.js"));
  else root.createKnotWorld = factory(root.planck);
})(typeof window === "undefined" ? globalThis : window, pl => {
  "use strict";
  const V = pl.Vec2;
  // Planck's polygon skin is twice linearSlop on *each* contact surface.
  // At this scale its default can leave a visibly white seam between two lines.
  pl.Settings.linearSlop = .00035;
  // Landing poses in SVG units measured from the floor. Each upper stroke
  // can reach its support by falling straight down its own column.
  const wideLandings = [
    [1059.403,-333.570,25.40754], [4156.091,-678.424,45.07489],
    [2134.433,-536.534,7.39028], [3305.940,-404.714,5.47746],
    [3759.093,-251.662,-.11332], [1381.130,-1148.813,-7.79604],
    [336.890,-1163.612,-63.33644], [2800,-1244.896,-174]
  ];
  const narrowLandings = [
    [860,-337.030,25], [3132.413,-1836.733,44], [1652.702,-867.321,6],
    [2487.682,-1527.268,5], [2596.471,-1002.457,-19], [1057.295,-1595.906,-11],
    [359.717,-2191.663,-62], [1661.384,-2359.019,-174]
  ];
  const sequence=[0,2,4,3,1,5,6,7];
  const tick = 1/60;
  // Give the three foundation marks one longer beat before the upper marks follow.
  const releaseTicks = placed => placed === 3 ? 14 : 8;
  const clamp = (n,min,max) => Math.max(min,Math.min(n,max));
  return function createKnotWorld(ink, width, height, {immediate=false,previous=null}={}) {
    const aspect=height/width;
    // A mobile toolbar changing height should move the floor, not reprint
    // the symbols at a different size on every scroll.
    const printAspect=previous && Math.abs(aspect-previous.printAspect)<.12 ? previous.printAspect : aspect;
    const narrow=printAspect>1.12;
    const order=sequence.filter(i=>i<ink.length);
    const landings=narrow ? narrowLandings : wideLandings;
    const sheetWidth=narrow ? 3750 : 4730;
    let guided=ink.length===landings.length && (!previous || previous.guided);
    if(guided && previous && printAspect!==previous.printAspect){
      immediate ||= !previous.active();
      previous=null;
    }
    // Keep a similar amount of printed ink per screen area; cap each axis
    // so a mark still fits comfortably on a very narrow or wide viewport.
    const printHeight=width*printAspect;
    const printScale=narrow ? .74*Math.min(width*.000425,Math.max(width*.000315,printHeight*.000235)) :
      .85*Math.min(.00748*Math.sqrt(width*printHeight/(32*18)),printHeight*.00046);
    const scale=Math.min(printScale,(width-.02)/sheetWidth);
    const inset=Math.max(.003,(width-sheetWidth*scale)*.18);
    const sizes=ink.map(()=>scale);
    // A fraction of an SVG unit keeps rounding at a shared edge from
    // putting one printed contour inside the next.
    const landingY=landings.map(([,y],i)=>height+(y-.015*order.indexOf(i))*scale);
    const world = new pl.World(V(0,23)), ground = world.createBody();
    const wall = {friction:.64,restitution:0};
    const barrier=(x,y,hw,hh)=>ground.createFixture(pl.Box(hw,hh,V(x,y),0),wall);
    const floor=barrier(width/2,height+1,width/2+2,1);
    barrier(-1,height/2,1,height+22); barrier(width+1,height/2,1,height+22);
    const bodies=Array(ink.length).fill(null);
    const fixtures={density:0,friction:.56,restitution:0};
    let count=0, joint=null, untilRelease=0;
    let grabOffset=V(0,0), supportedTime=0, parked=false;
    const reach=ink.map((shape,i)=>Math.hypot(shape.w,shape.h)*sizes[i]/2);
    // Do not introduce a symbol halfway through another line. Look for a
    // nearby clear pose using the ink fixtures, including their open centres.
    function clearEntry(body, preferred, angle, dropping, i) {
      // Include the visible page edges without treating the SVG viewBox as ink.
      const atOrigin = new pl.Transform(V(0,0), angle), box = new pl.AABB();
      let minX=Infinity, maxX=-Infinity, maxY=-Infinity;
      for(let f=body.getFixtureList();f;f=f.getNext()){
        f.getShape().computeAABB(box,atOrigin,0);
        minX=Math.min(minX,box.lowerBound.x); maxX=Math.max(maxX,box.upperBound.x);
        maxY=Math.max(maxY,box.upperBound.y);
      }
      const fit=p=>V(clamp(p.x,-minX+.002,width-maxX-.002),Math.min(p.y,height-maxY-.002));
      // The lowest painted point of a rotated mark starts above the screen.
      preferred=fit(dropping ? V(preferred.x,-maxY-height*.035) : preferred);
      if(guided && dropping){
        // Until both strokes arrive, preserve their vertical order even when
        // a large upper loop shares the column of a smaller falling loop.
        let distance=0;
        bodies.forEach((other,j)=>{
          if(other)distance=Math.max(distance,landingY[j]-other.getPosition().y);
        });
        return V(preferred.x,Math.min(preferred.y,landingY[i]-distance));
      }
      if (!count) return preferred;
      const bounds = new pl.AABB();
      function fits(position) {
        const transform = new pl.Transform(position, angle);
        for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
          const shape = fixture.getShape();
          shape.computeAABB(bounds, transform, 0);
          let clear = true;
          world.queryAABB(bounds, other => {
            const neighbor = other.getBody();
            if (neighbor !== body && neighbor !== ground) {
              clear = !pl.testOverlap(shape, 0, other.getShape(), 0, transform, neighbor.getTransform());
            }
            return clear;
          });
          if (!clear) return false;
        }
        return true;
      }
      if (fits(preferred)) return preferred;
      if (dropping) {
        // If the pile has risen into this lane, enter above the obstructing
        // strokes. Keep the same x so new pieces cannot jump below the pile.
        const entry=V(preferred.x,preferred.y);
        do {entry.y-=.4;} while(!fits(entry));
        return entry;
      }
      for (let radius = .35; radius <= width; radius += .35) {
        for (let ray = 0; ray < 20; ray++) {
          const direction = ray * Math.PI / 10;
          const point = fit(V(preferred.x + radius * Math.cos(direction), preferred.y + radius * Math.sin(direction)));
          if (point.x >= 0 && point.x <= width && point.y <= height && fits(point)) return point;
        }
      }
      // Above even the first symbol's starting position there is always room.
      return V(preferred.x, -height - body.getLocalCenter().length() - width);
    }
    function spawn(i, instant, previousBody=null) {
      const shape=ink[i], scale=sizes[i];
      const [x,,degrees]=landings[i], end=V(inset+x*scale,landingY[i]);
      const tilt=degrees*Math.PI/180;
      // A browser toolbar resize moves the floor. Carry the pile with it,
      // preserving contacts by giving every mark the same scale and offset.
      const ratio=previousBody ? scale/previous.sizes[i] : 1;
      const fitsAcross=previousBody && previous.width*ratio<=width+.00001;
      let preferred=end;
      if(previousBody){
        const p=previousBody.getPosition();
        preferred=V(fitsAcross ? p.x*ratio+(width-previous.width*ratio)/2 : p.x*width/previous.width,
          height+(p.y-previous.height)*ratio);
      }
      const bodyAngle = previousBody ? previousBody.getAngle() : tilt;
      const b = world.createDynamicBody({
        position: preferred, angle: bodyAngle, bullet: true, active: false,
        linearDamping: .45, angularDamping: .85
      });

      // The convex pieces tile the painted SVG silhouette. Its holes are empty.
      for (const polygon of shape.polygons) {
        const vertices = polygon.map(([x,y]) => V(x*scale, y*scale));
        b.createFixture(pl.Polygon(vertices), fixtures);
      }
      // The pieces form one body. Calculate its mass once and register it in
      // the collision index only after finding the actual entry position.
      for(let f=b.getFixtureList();f;f=f.getNext())f.setDensity(1);
      b.resetMassData();
      const atLanding=guided && instant && !previousBody;
      const entry = fitsAcross || atLanding ? preferred : clearEntry(b, preferred, bodyAngle, !instant, i);
      b.setTransform(entry, bodyAngle);
      b.setActive(true);
      if(previousBody){
        const v=previousBody.getLinearVelocity();
        b.setLinearVelocity(V(v.x*ratio,v.y*ratio));
        b.setAngularVelocity(previousBody.getAngularVelocity());
      }else if(!instant)b.setLinearVelocity(V(0,height*1.75));
      else if(atLanding)b.setAwake(false);
      bodies[i]=b; count++;
      return b;
    }
    if(previous){
      for(const i of order){
        if(previous.bodies[i] || immediate)spawn(i,true,previous.bodies[i]);
      }
      if(count===order.length && !previous.active() && previous.width*sizes[0]/previous.sizes[0]<=width+.00001){
        for(const b of bodies)b.setAwake(false);
        parked=true;
      }
      untilRelease=count ? releaseTicks(count) : 0;
      previous=null; // Release the old collision meshes after reflow.
    }else if(immediate){
      order.forEach(i=>spawn(i,true));
      parked=guided;
    }
    // Trace upward-facing contacts from the real floor. A side wall or a
    // passing brush in midair is not enough to put a symbol to sleep.
    function settleContacts() {
      const supported=new Set([ground]);
      for(const base of supported){
        for(let edge=base.getContactList();edge;edge=edge.next){
          if(supported.has(edge.other) || !edge.contact.isTouching())continue;
          const a=edge.contact.getFixtureA(), b=edge.contact.getFixtureB();
          if(base===ground && a!==floor && b!==floor)continue;
          const normal=edge.contact.getWorldManifold(null).normal;
          const upward=a.getBody()===base ? -normal.y : normal.y;
          if(upward>.025){
            supported.add(edge.other);
          }
        }
      }
      let fastest=0;
      for(const [i,b] of bodies.entries()){
        if(!b)continue;
        const touching=supported.has(b) && b!==joint?.getBodyB();
        b.setLinearDamping(touching ? 12 : .45);
        b.setAngularDamping(touching ? 18 : .85);
        fastest=Math.max(fastest,b.getLinearVelocity().length()+Math.abs(b.getAngularVelocity())*reach[i]);
      }
      if(joint || supported.size!==count+1){
        supportedTime=0;
        return;
      }
      supportedTime+=tick;
      if(supportedTime<.14 || (fastest>.75 && supportedTime<.40))return;
      // A later arrival wakes the pieces it lands on.
      for(const b of bodies)if(b)b.setAwake(false);
      supportedTime=0;
      parked=count===order.length;
    }
    function step() {
      if(parked)return;
      if(count<order.length){
        if(untilRelease===0){
          spawn(order[count],false);
          untilRelease=releaseTicks(count);
        }
        untilRelease--;
      }
      if(guided){
        // During the opening only gravity changes the pose, along y. Each
        // mark stops at its first painted support and stays where it landed.
        let allLanded=count===order.length;
        bodies.forEach((body,i)=>{
          if(!body)return;
          const position=body.getPosition();
          if(position.y>=landingY[i])return;
          const speed=body.getLinearVelocity().y+world.getGravity().y*tick;
          const y=Math.min(position.y+speed*tick,landingY[i]);
          body.setTransform(V(position.x,y),body.getAngle());
          if(y===landingY[i])body.setAwake(false);
          else{
            body.setLinearVelocity(V(0,speed));
            allLanded=false;
          }
        });
        parked=allLanded;
        return;
      }
      // A rotating tip moves faster than the centre. Shorten the physics step
      // during a fast pull or drop to keep the thin fixtures from skipping one another.
      let speed=0;
      for(let i=0;i<bodies.length;i++){
        const b=bodies[i];
        if(!b || !b.isAwake())continue;
        speed=Math.max(speed,b.getLinearVelocity().length()+Math.abs(b.getAngularVelocity())*reach[i]);
      }
      const steps=clamp(Math.ceil(speed*tick/.16),1,4);
      const dt=tick/steps;
      for(let sub=0;sub<steps;sub++){
        world.step(dt,10,8);
      }
      settleContacts();
    }
    function release(followThrough=false) {
      if (!joint) return;
      if (followThrough) {
        // A quick flick may finish between two physics ticks. Transfer the
        // remaining pull to the grabbed point without teleporting the drawing.
        const b=joint.getBodyB(), p=joint.getAnchorB(), t=joint.getTarget();
        const dx=t.x-p.x,dy=t.y-p.y,d=Math.hypot(dx,dy);
        if(d>.15) {
          const k=Math.min(3,9/d)*b.getMass();
          b.applyLinearImpulse(V(k*dx,k*dy),p,true);
        }
      }
      world.destroyJoint(joint);
      joint=null;
    }
    function takeControl(i) {
      const b=bodies[i]; if(!b)return;
      if(guided){
        // Hand over the exact pose and velocity, even halfway through a drop.
        guided=false;
        for(const body of bodies)if(body)body.setAwake(true);
      }
      parked=false; supportedTime=0;
      b.setAwake(true);
      return b;
    }
    function nearestInk(i, point) {
      const body=bodies[i], scale=sizes[i], local=body.getLocalPoint(point);
      const px=local.x/scale, py=local.y/scale;
      let nearest=Infinity, bestX=0, bestY=0;
      for(const path of ink[i].paths)for(let j=1;j<path.length;j++){
        const [ax,ay]=path[j-1], [bx,by]=path[j];
        const dx=bx-ax, dy=by-ay;
        const t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy || 1),0,1);
        const x=ax+t*dx, y=ay+t*dy, distance=(px-x)**2+(py-y)**2;
        if(distance<nearest){nearest=distance;bestX=x;bestY=y;}
      }
      return {local:V(bestX*scale,bestY*scale), distance:Math.sqrt(nearest)*scale};
    }
    function hold(i,x,y) {
      release(); const b=takeControl(i); if(!b)return;
      const pointer=V(x,y);
      let best=nearestInk(i,pointer).local;
      // Keep a grab inside a wide painted terminal at the pointer; a grab in
      // whitespace still reaches the nearest contour without snapping.
      for (let fixture=b.getFixtureList(); fixture; fixture=fixture.getNext()) {
        if (fixture.testPoint(pointer)) {
          best=b.getLocalPoint(pointer);
          break;
        }
      }
      const anchor=b.getWorldPoint(best);
      grabOffset=V(anchor.x-x,anchor.y-y);
      joint=world.createJoint(new pl.MouseJoint({maxForce:b.getMass()*210,frequencyHz:6.5,dampingRatio:.93},ground,b,anchor));
    }
    function move(x,y) {
      if(!joint)return;
      // A grabbed loop can extend far beyond the pointer. Limit the pull at
      // its painted edge so a throw cannot wedge the loop into the side wall.
      const b=joint.getBodyB(), anchor=joint.getAnchorB(), box=new pl.AABB();
      let left=Infinity,right=-Infinity,bottom=-Infinity;
      for(let f=b.getFixtureList();f;f=f.getNext()){
        f.getShape().computeAABB(box,b.getTransform(),0);
        left=Math.min(left,box.lowerBound.x);right=Math.max(right,box.upperBound.x);
        bottom=Math.max(bottom,box.upperBound.y);
      }
      joint.setTarget(V(clamp(x+grabOffset.x,anchor.x-left,anchor.x+width-right),
        clamp(y+grabOffset.y,.08,anchor.y+height-bottom)));
    }
    function nudge(i,dx,dy) {
      const b=takeControl(i); if(!b)return;
      b.applyLinearImpulse(V(dx*b.getMass(),dy*b.getMass()),b.getWorldCenter(),true);
    }
    return {width,height,printAspect,bodies,sizes,step,tick,hold,move,release,nudge,nearestInk,
      get guided(){return guided;},
      active:()=>!parked && (!!joint || count<ink.length || bodies.some(b=>b?.isAwake()))};
  };
});
