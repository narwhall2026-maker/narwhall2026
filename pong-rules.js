export const WIDTH=800,HEIGHT=500,PADDLE_HALF=58;
export const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function newPongRound(direction=1){return {paddles:[250,250],targets:[250,250],ball:{x:400,y:250,vx:direction*360,vy:120},hits:0,winner:null};}
export function stepPong(s,dt){
 if(s.winner!==null)return;
 for(let i=0;i<2;i++)s.paddles[i]+=clamp(s.targets[i]-s.paddles[i],-600*dt,600*dt);
 const b=s.ball,oldX=b.x;b.x+=b.vx*dt;b.y+=b.vy*dt;
 if(b.y<8){b.y=16-b.y;b.vy=Math.abs(b.vy);}if(b.y>492){b.y=984-b.y;b.vy=-Math.abs(b.vy);}
 const side=b.vx<0?0:1,edge=side===0?38:762;
 if((side===0&&oldX>=edge&&b.x<=edge)||(side===1&&oldX<=edge&&b.x>=edge)){
  if(Math.abs(b.y-s.paddles[side])<=PADDLE_HALF+7){
   const angle=clamp((b.y-s.paddles[side])/PADDLE_HALF,-1,1)*1.05,speed=Math.min(760,Math.hypot(b.vx,b.vy)+24);
   b.x=side===0?edge+1:edge-1;b.vx=(side===0?1:-1)*Math.cos(angle)*speed;b.vy=Math.sin(angle)*speed;s.hits++;
  }
 }
 if(b.x<-10)s.winner=1;if(b.x>810)s.winner=0;
}
