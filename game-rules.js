const SNAKE_DIRS={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
export function newWallSnake(){
  return {body:[{x:7,y:10},{x:6,y:10},{x:5,y:10}],direction:SNAKE_DIRS.right,next:SNAKE_DIRS.right,food:{x:14,y:10},score:0,running:false,over:false,turned:false};
}
export function placeSnakeFood(state){
  const free=[];
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(!state.body.some(p=>p.x===x&&p.y===y))free.push({x,y});
  const random=state.rng===undefined?Math.random():((state.rng=(Math.imul(1664525,state.rng)+1013904223)>>>0)/4294967296);
  return free.length?free[Math.floor(random*free.length)]:null;
}
export function snakeStep(s){
  if(s.run){if(s.run.proof.length>=3750){s.over=true;s.running=false;return;}s.run.proof.push(s.next.y<0?0:s.next.x>0?1:s.next.y>0?2:3);}
  s.direction=s.next;s.turned=false;
  const head={x:s.body[0].x+s.direction.x,y:s.body[0].y+s.direction.y};
  const eats=head.x===s.food.x&&head.y===s.food.y;
  const obstacles=eats?s.body:s.body.slice(0,-1);
  if(head.x<0||head.x>=20||head.y<0||head.y>=20||obstacles.some(p=>p.x===head.x&&p.y===head.y)){s.running=false;s.over=true;return;}
  s.body.unshift(head);
  if(eats){s.score++;s.food=placeSnakeFood(s);if(!s.food){s.running=false;s.over=true;}}
  else s.body.pop();
}
export function newWallBounce(){
  const bubbles=[];
  for(let row=0;row<4;row++)for(let col=0;col<6;col++)bubbles.push({x:65+col*94,y:65+row*62,r:24,alive:true});
  return {paddle:300,ball:{x:300,y:535,vx:125,vy:-265},bubbles,score:0,lives:3,running:false,ready:true,over:false};
}
export function moveBouncePaddle(s,x){s.paddle=Math.max(58,Math.min(542,x));if(s.ready)s.ball.x=s.paddle;}
export function bounceStep(s,dt,input=0){
  if(!s.running||s.over)return;
  moveBouncePaddle(s,Math.round(s.paddle*10)/10);
  if(s.run){if(s.run.proof.length>=72000){s.over=true;s.running=false;return;}s.run.proof.push([Math.round(s.paddle*10),input]);}
  moveBouncePaddle(s,s.paddle+input*440*dt);
  const b=s.ball,previousY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(b.x<9){b.x=9;b.vx=Math.abs(b.vx);}if(b.x>591){b.x=591;b.vx=-Math.abs(b.vx);}
  if(b.y<9){b.y=9;b.vy=Math.abs(b.vy);}
  if(b.vy>0&&previousY+9<=553&&b.y+9>=550&&b.x>=s.paddle-65&&b.x<=s.paddle+65){
    b.y=541;const angle=Math.max(-1,Math.min(1,(b.x-s.paddle)/62))*1.05;
    const speed=Math.min(390,Math.hypot(b.vx,b.vy)+3);b.vx=Math.sin(angle)*speed;b.vy=-Math.cos(angle)*speed;
  }
  for(const bubble of s.bubbles){
    if(!bubble.alive)continue;const dx=b.x-bubble.x,dy=b.y-bubble.y,distance=Math.hypot(dx,dy);
    if(distance<bubble.r+9){
      const nx=distance?dx/distance:0,ny=distance?dy/distance:1,dot=b.vx*nx+b.vy*ny;
      if(dot<0){b.vx-=2*dot*nx;b.vy-=2*dot*ny;}
      b.x=bubble.x+nx*(bubble.r+10);b.y=bubble.y+ny*(bubble.r+10);bubble.alive=false;s.score+=10;break;
    }
  }
  if(s.bubbles.every(p=>!p.alive)){s.over=true;s.running=false;}
  else if(b.y>620){s.lives--;s.running=false;s.ready=true;s.over=s.lives===0;s.ball={x:s.paddle,y:535,vx:125,vy:-265};}
}
