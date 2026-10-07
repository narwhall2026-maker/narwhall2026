import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const seed=[
 {id:1,name:'Maya',handle:'@maya',emoji:'🪼',caption:'sea you',time:'2h',color:'a'},
 {id:2,name:'Leo',handle:'@leo',emoji:'🐚',caption:'tiny joy',time:'5h',color:'b'},
 {id:3,name:'You',handle:'@you',emoji:'🦄',caption:'good day',time:'now',color:'c'}
];
const MAX=15;
const chars=s=>Array.from(s).slice(0,MAX).join('');
function load(){try{return JSON.parse(localStorage.getItem('narwhal-moments'))||seed}catch{return seed}}
function App(){
 const [tab,setTab]=useState('wall');
 const [moments,setMoments]=useState(load);
 const [caption,setCaption]=useState('');
 const [photo,setPhoto]=useState(null);
 const [friends,setFriends]=useState(['Maya','Leo','Sam']);
 useEffect(()=>localStorage.setItem('narwhal-moments',JSON.stringify(moments)),[moments]);
 const count=useMemo(()=>moments.length,[moments]);
 function add(){const text=chars(caption.trim());if(!text)return;setMoments([{id:Date.now(),name:'You',handle:'@you',emoji:'🦄',caption:text,time:'now',color:'c',photo},...moments]);setCaption('');setPhoto(null);setTab('wall')}
 function file(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>setPhoto(r.result);r.readAsDataURL(f)}
 return <div className="app">
  <header><div className="brand"><span className="whale">🐋</span><b>Narwhal</b></div><button className="avatar" onClick={()=>setTab('profile')}>♟</button></header>
  <main>
   {tab==='wall'&&<section className="wall">
    <div className="intro"><h1>my Moments!</h1><p>are worth capturing</p></div>
    <div className="moment-stage">{moments.length===0&&<div className="empty">No moments yet.<br/>Capture one!</div>}{moments.slice(0,6).map((m,i)=><article className={'polaroid p'+i} key={m.id}>
      <div className="photo-wrap">{m.photo?<img src={m.photo} alt="moment"/>:<div className="placeholder">{m.emoji}</div>}</div>
      <div className="polaroid-caption">{m.caption}</div>
      <button className="trash" aria-label="delete">▥</button>
    </article>)}</div>
    <button className="capture-pill" onClick={()=>setTab('capture')}><span>📸</span> Capture</button>
   </section>}
   {tab==='capture'&&<section className="capture"><button className="back" onClick={()=>setTab('wall')}>←</button><h1>Capture a moment</h1><p className="sub">Keep the feeling tiny — <b>15 characters max.</b></p><label className="photo-box">{photo?<img src={photo} alt="preview"/>:<><span>＋</span><b>Add a photo</b><small>JPG, PNG or GIF</small></>}<input type="file" accept="image/*" onChange={file}/></label><div className="field"><input autoFocus maxLength={MAX} value={caption} onChange={e=>setCaption(chars(e.target.value))} placeholder="Your caption..."/><span>{Array.from(caption).length}/{MAX}</span></div><button className="primary" disabled={!caption.trim()} onClick={add}>Save moment <span>→</span></button></section>}
   {tab==='friends'&&<section className="page"><p className="eyebrow">YOUR CIRCLE</p><h1>Friends</h1><div className="friend-list">{friends.map((f,i)=><div className="friend" key={f}><span>{['🪼','🐚','🐳'][i%3]}</span><div><b>{f}</b><small>@{f.toLowerCase()} · active today</small></div><button>{i===2?'Add':'Following'}</button></div>)}</div><button className="outline" onClick={()=>setFriends([...friends,'Nora'])}>＋ Add a friend</button></section>}
   {tab==='profile'&&<section className="profile"><div className="big-avatar">🦄</div><h1>You</h1><p>@you</p><div className="stats"><div><b>{count}</b><span>moments</span></div><div><b>{friends.length}</b><span>friends</span></div><div><b>15</b><span>max chars</span></div></div><div className="note">Your moments stay on this device. ✦</div></section>}
  </main>
  <nav><button className={tab==='wall'?'active':''} onClick={()=>setTab('wall')}><span>⌂</span>Wall</button><button className={tab==='friends'?'active':''} onClick={()=>setTab('friends')}><span>♣</span>Friends</button><button className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}><span>♟</span>Profile</button></nav>
 </div>
}
createRoot(document.getElementById('root')).render(<App/>);