const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const makeWorld = require("../symbol-world");
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../symbol-ink.js"),"utf8"),ctx);
const ink=ctx.window.KNOTATION_INK;

test("a small mark drops through the empty middle of a loop and lands on its lower stroke",()=>{
  const strip=(x1,y1,x2,y2)=>[[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
  const polygons=[strip(-206,-206,206,-194),strip(-206,194,206,206),
    strip(-206,-194,-194,194),strip(194,-194,206,194)];
  const loop={w:412,h:412,paths:[],polygons};
  const bead={w:30,h:30,paths:[],polygons:[strip(-15,-15,15,15)]};
  const sim=makeWorld([loop,bead],32,18,{immediate:true});
  const [ring,ball]=sim.bodies;
  ring.setTransform(ring.getPosition(),0); // This test drops the bead into a level loop.
  const center=ring.getPosition();
  ball.setTransform({x:center.x,y:center.y-.6},0);
  sim.nudge(1,0,18);
  for(let i=0;i<270;i++)sim.step();
  const y=ball.getPosition().y, bottom=ring.getPosition().y+200*sim.sizes[0];
  assert.ok(y>ring.getPosition().y+.8 && y<bottom, 'bead rests inside the ring on the lower ink');
});

// A true crossing is different from two ink edges touching. Compare the
// visible boundary curves of different SVGs, never the paths of a glyph to itself.
function assertNoCrossedStrokes(sim) {
  const previous=[];
  const side=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
  sim.bodies.forEach((body,i)=>{
    if(!body)return;
    const local=[];
    for(const path of ink[i].paths){
      const points=path.map(([x,y])=>body.getWorldPoint({x:x*sim.sizes[i],y:y*sim.sizes[i]}));
      for(let j=1;j<points.length;j++){
        const a=points[j-1],b=points[j];
        for(const [c,d] of previous){
          if(side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0)
            assert.fail("the visible stroke of glyph "+(i+1)+" crosses another glyph");
        }
        local.push([a,b]);
      }
    }
    previous.push(...local);
  });
}

function settle(field) {
  for(let i=0;i<1800 && field.active();i++)field.step();
  assert.equal(field.active(),false,"the pile reaches rest under gravity");
}

// Test the rendered ink outlines, independent of the engine's contact flags.
// Every resting mark must have a chain of close visible edges down to the floor.
function assertSupported(sim,height,ppm,{singlePile=true}={}) {
  const tolerance=.15/ppm; // less than a fifth of a CSS pixel of daylight
  const shapes=sim.bodies.map((b,i)=>ink[i].paths.map(path=>path.map(([x,y])=>
    b.getWorldPoint({x:x*sim.sizes[i],y:y*sim.sizes[i]}))));
  const supported=new Set(), adjacent=shapes.map(()=>new Set());
  function onSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance;
  }
  function near(paths,others){
    for(const path of paths)for(let k=1;k<path.length;k++){
      const a=path[k-1],b=path[k];
      for(const other of others)for(let l=1;l<other.length;l++){
        const c=other[l-1],d=other[l];
        if(Math.max(a.x,b.x)+tolerance<Math.min(c.x,d.x) || Math.max(c.x,d.x)+tolerance<Math.min(a.x,b.x) ||
           Math.max(a.y,b.y)+tolerance<Math.min(c.y,d.y) || Math.max(c.y,d.y)+tolerance<Math.min(a.y,b.y))continue;
        if(onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b))return true;
      }
    }
    return false;
  }
  for(const [i,paths] of shapes.entries()){
    const lowest=Math.max(...paths.flat().map(p=>p.y));
    if(Math.abs(height-lowest)<=tolerance)supported.add(i);
    for(let j=0;j<i;j++)if(near(paths,shapes[j])){adjacent[i].add(j);adjacent[j].add(i);}
  }
  for(const i of supported)for(const j of adjacent[i])supported.add(j);
  assert.equal(supported.size,shapes.length,"no glyph floats above a gap");
  // A shared floor alone does not connect two outlines.
  const connected=new Set([0]);
  for(const i of connected)for(const j of adjacent[i])connected.add(j);
  if(singlePile)assert.equal(connected.size,shapes.length,"all painted marks must meet through ink alone");
}

// Measure the resting silhouette using actual ink; empty SVG margins and
// rotation can make the body centres misleading.
function assertDiagonalPile(sim) {
  const tops=Array(4).fill(Infinity);
  let right=0;
  sim.bodies.forEach((body,i)=>{
    for(const path of ink[i].paths)for(const [x,y] of path){
      const point=body.getWorldPoint({x:x*sim.sizes[i],y:y*sim.sizes[i]});
      const band=Math.max(0,Math.min(3,Math.floor(point.x/sim.width*4)));
      tops[band]=Math.min(tops[band],point.y/sim.height);
      right=Math.max(right,point.x/sim.width);
    }
  });
  assert.ok(tops.every(Number.isFinite),"ink extends across the sheet");
  assert.ok(right>.90,"the connected base reaches across the screen");
  assert.ok(tops[0]>.28 && tops[0]<.48 && tops[1]>tops[0] && tops[3]>tops[0]+.12,
    "the pile sits low, with more open space above the right end: "+tops.join(", "));
}

test("marks enter from above in a rapid stagger and settle in a diagonal pile",()=>{
  const sim=makeWorld(ink,32,18);
  const arrivals=[], releasedAt=[], visibleAt=[], releaseX=[], landedAt=[];
  for(let i=0;i<1200 && sim.active();i++){
    const before=sim.bodies.slice();
    sim.step();
    const newMarks=sim.bodies.filter((body,j)=>body && !before[j]);
    if(newMarks.length){
      assert.equal(newMarks.length,1);
      const index=sim.bodies.indexOf(newMarks[0]);
      arrivals.push(index);
      releasedAt.push(i);
      releaseX[index]=newMarks[0].getPosition().x;
    }
    for(const index of arrivals){
      const mark=sim.bodies[index], position=mark.getPosition();
      assert.ok(Math.abs(position.x-releaseX[index])<.00001,"no sideways drift before or after impact");
      if(landedAt[index]!==undefined)assert.equal(position.y,landedAt[index],"later arrivals cannot shift a settled mark");
      if(!mark.isAwake())landedAt[index]=position.y;
      if(visibleAt[index]!==undefined)continue;
      const body=sim.bodies[index], scale=sim.sizes[index];
      const bottom=Math.max(...ink[index].paths.flat().map(([x,y])=>body.getWorldPoint({x:x*scale,y:y*scale}).y));
      if(!before[index])assert.ok(bottom<0,"the whole rotated mark starts outside the viewport");
      if(bottom>=0){
        assert.ok(bottom<sim.height*.06,"the first visible stroke crosses the top edge");
        visibleAt[index]=i;
      }
    }
    if(i%18===0)assertNoCrossedStrokes(sim);
  }
  assert.equal(sim.active(),false);
  assert.deepEqual(arrivals,[0,2,4,3,1,5,6,7]);
  const intervals=releasedAt.slice(1).map((t,i)=>t-releasedAt[i]);
  assert.deepEqual(intervals,[8,8,14,8,8,8,8],"only the transition out of the foundation gets an extra beat");
  const entryTimes=arrivals.map(i=>visibleAt[i]*sim.tick);
  assert.ok(entryTimes[0]<.15 && entryTimes.at(-1)<1.25);
  assert.ok(entryTimes.slice(1).every((t,i)=>t>entryTimes[i] && t-entryTimes[i]<.33));
  assertNoCrossedStrokes(sim);
  assertSupported(sim,18,60);
  assertDiagonalPile(sim);
});

test("the portrait pile and reduced-motion still also rest on visible strokes",()=>{
  for(const [width,height,ppm,immediate] of [[19,41.12,21,false],[32,18.61,50,true],[19,41.12,21,true]]){
    const sim=makeWorld(ink,width,height,{immediate});
    settle(sim);
    assertSupported(sim,height,ppm);
    assertNoCrossedStrokes(sim);
  }
});

test("a right-hand mark released away from the pile falls onto its own support",()=>{
  const sim=makeWorld(ink,32,18);
  settle(sim);
  const i=1, moved=sim.bodies[i], start=moved.getWorldCenter().clone();
  sim.hold(i,start.x,start.y);
  sim.move(31,4.5);
  for(let frame=0;frame<100;frame++)sim.step();
  const separated=moved.getWorldCenter().clone();
  for(let edge=moved.getContactList();edge;edge=edge.next){
    assert.ok(!sim.bodies.includes(edge.other) || !edge.contact.isTouching());
  }
  sim.release();
  settle(sim);
  assert.ok(moved.getWorldCenter().y>separated.y+1);
  assertSupported(sim,18,60,{singlePile:false});
  assertNoCrossedStrokes(sim);
});

test("picking up and releasing a mark restores gravity",()=>{
  const sim=makeWorld([ink[4]],32,18,{immediate:true});
  settle(sim);
  const b=sim.bodies[0], start={...b.getWorldCenter()};
  sim.hold(0,start.x,start.y);sim.move(start.x,start.y-5);
  for(let i=0;i<110;i++)sim.step();
  const lifted=b.getWorldCenter().y;
  assert.ok(lifted<start.y-3,"picked mark follows the grab point");
  sim.release(true);
  for(let i=0;i<160;i++)sim.step();
  assert.ok(b.getWorldCenter().y>lifted+1,"released mark comes back down");

});

test("a drag on Stability pushes Tension only when their actual strokes meet",()=>{
  // Start both marks resting on separate
  // parts of the same floor, then drag the second through the empty space.
  const sim=makeWorld([ink[3],ink[4]],32,18,{immediate:true});
  const [neighbor,moving]=sim.bodies;
  for(const [i,body] of sim.bodies.entries()){
    const bottom=Math.max(...ink[i+3].paths.flat().map(([,y])=>y))*sim.sizes[i];
    body.setTransform({x:i===0?10:22,y:18-bottom},0);
  }
  neighbor.setFixedRotation(true); // Isolate horizontal pushing from rolling under gravity.
  const start={...moving.getWorldCenter()}, rest={...neighbor.getPosition()};
  let encountered=false, push=0;
  sim.hold(1,start.x,start.y);
  for(let frame=0;frame<240;frame++){
    const progress=Math.min(1,frame/120);
    sim.move(start.x-12*progress,start.y-.8*progress);
    sim.step();
    for(let edge=moving.getContactList();edge;edge=edge.next){
      if(edge.other===neighbor && edge.contact.isTouching())encountered=true;
    }
    const p=neighbor.getPosition(), distance=Math.hypot(p.x-rest.x,p.y-rest.y);
    if(encountered)push=Math.max(push,distance);
    else assert.ok(distance<.01,"overlapping image bounds do not push the neighbor");
  }
  assert.ok(encountered && push>.45,"contact visibly deflects the neighboring symbol");
});

test("the original SVG terminals are solid or hollow in the collision mesh just as they are on screen",()=>{
  const field=makeWorld(ink,32,18,{immediate:true});
  const inside=(i,x,y)=>{
    const b=field.bodies[i], s=ink[i];
    const point=b.getWorldPoint({x:(x/1277-.5)*s.w*field.sizes[i],y:(y/1232-.5)*s.h*field.sizes[i]});
    for(let f=b.getFixtureList();f;f=f.getNext()) if(f.testPoint(point))return true;
    return false;
  };
  assert.equal(inside(1,511,604.93),true,"the filled Response terminal has mass");
  assert.equal(inside(3,531.11,527.98),false,"white centre of the Tension terminal is open");
  assert.equal(inside(3,546.11,527.98),true,"its black rim collides");
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  const rendered=[...html.matchAll(/class="about-symbol" data-symbol-src="([^"?]+)/g)].map(m=>m[1]);
  assert.deepEqual(rendered,Array.from(ink, shape=>shape.source));
});

test("an untouched pile settles, stays put through hover and a toolbar resize, and can be picked up again",()=>{
  const field=makeWorld(ink,32,19.98);
  settle(field);
  assertSupported(field,19.98,50);
  const poses=sim=>sim.bodies.map(b=>[b.getPosition().x,b.getPosition().y,b.getAngle()]);
  const rest=poses(field);
  for(let i=0;i<120;i++){
    field.nearestInk(3,field.bodies[3].getWorldCenter());
    field.step();
  }
  assert.deepEqual(poses(field),rest);
  const resized=makeWorld(ink,32,20.48,{previous:field});
  assert.equal(resized.active(),false);
  poses(resized).forEach(([x,y,a],i)=>{
    assert.ok(Math.abs(x-rest[i][0])<1e-8 && Math.abs(y-rest[i][1]-.5)<1e-8 && Math.abs(a-rest[i][2])<1e-8);
  });
  const moving=resized.bodies[4], start={...moving.getWorldCenter()};
  resized.hold(4,start.x,start.y);resized.move(start.x,start.y-4);
  for(let i=0;i<60;i++)resized.step();
  assert.ok(moving.getWorldCenter().y<start.y-2);
  resized.release();
  settle(resized);
  assertSupported(resized,20.48,50,{singlePile:false});
});

test("a title anchor stays on its own rotated SVG outline, even when the pointer is inside a loop",()=>{
  const sim=makeWorld(ink,32,18,{immediate:true});
  const i=3,b=sim.bodies[i],s=sim.sizes[i];
  const path=ink[i].paths[0];
  const [a,c]=path;
  const midpoint={x:(a[0]+c[0])*s/2,y:(a[1]+c[1])*s/2};
  for(const angle of [0,.72]){
    b.setTransform({x:15,y:8},angle);
    const exact=sim.nearestInk(i,b.getWorldPoint(midpoint));
    assert.ok(exact.distance<1e-9);
    const fromHole=sim.nearestInk(i,b.getWorldCenter());
    assert.ok(sim.nearestInk(i,b.getWorldPoint(fromHole.local)).distance<1e-9);
  }
});
