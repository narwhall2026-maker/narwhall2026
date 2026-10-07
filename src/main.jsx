import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const seed = [
 {id:1,name:'Maya',handle:'@maya',emoji:'🪼',caption:'sea you',time:'2h',color:'a'},
 {id:2,name:'Leo',handle:'@leo',emoji:'🐚',caption:'tiny joy',time:'5h',color:'b'},
 {id:3,name:'You',handle:'@you',emoji:'🦄',caption:'good day',time:'now',color:'c'}
];
const MAX=15;
function load(){try{return JSON.parse(localStorage.getItem('narwhal-moments'))||seed}catch{return seed}}
function App(){
 const [tab,setTab]=useState('wall'); const [moments,setMoments]=useState(load); const [caption,setCaption]=useState(''); const [photo,setPhoto]=useState(null); const [friends,setFriends]=useState(['Maya','Leo','Sam']);
 useEffect(()=>localStorage.setItem('narwhal-moments',JSON.stringify(moments)),[moments]);
 const count=useMemo(()=>moments.length,[moments]);
 function add(){if(!caption.trim())return;setMoments([{id:Date.now(),name:'You',handle:'@you',emoji:'🦄',caption:caption.slice(0,MAX),time:'now',color:'c',photo},...moments]);setCaption('');setPhoto(null);setTab('wall')}
 function file(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>setPhoto(r.result);r.readAsDataURL(f)}
 return <div className="app"><header><div className="brand"><span>🦄</span><div><b>Narwhal</b><small>little moments, together</small></div></div><button className="avatar">Y</button></header>
 <main>{tab==='wall'&&<section><div className="hero"><div><p className="eyebrow">YOUR OCEAN</p><h1>Friends make<br/>small things <i>big.</i></h1></div><div className="bubble">{count}<span>moments</span></div></div><div className="friends-row"><div><strong>Your friends</strong><span>{friends.length} nearby</span></div><div className="faces">{friends.map((x,i)=><span key={x} title={x}>{['🪼','🐚','🐳'][i%3]}</span>)}</div></div><div className="feed">{moments.map(m=><article className="card" key={m.id}><div className="card-top"><div className={'person p'+m.color}>{m.emoji}</div><div><b>{m.name}</b><span>{m.handle} · {m.time}</span></div><button>•••</button></div>{m.photo&&<img className="moment-img" src={m.photo}/>}<div className="caption">{m.caption}</div><div className="actions"><button>♡</button><button>↗</button></div></article>)}</div></section>}
 {tab==='capture'&&<section className="capture"><p className="eyebrow">NEW MOMENT</p><h1>Keep it tiny.</h1><p className="sub">A photo, a feeling, a few letters.</p><label className="photo-box">{photo?<img src={photo}/>:<><span>＋</span><b>Add a photo</b><small>JPG, PNG or GIF</small></>}<input type="file" accept="image/*" onChange={file}/></label><div className="field"><input autoFocus maxLength={MAX} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Say something..."/><span>{caption.length}/{MAX}</span></div><button className="primary" disabled={!caption.trim()} onClick={add}>Share moment <span>→</span></button></section>}
 {tab==='friends'&&<section><p className="eyebrow">YOUR CIRCLE</p><h1>Good people<br/><i>close by.</i></h1><div className="friend-list">{friends.map((f,i)=><div className="friend" key={f}><span>{['🪼','🐚','🐳'][i%3]}</span><div><b>{f}</b><small>@{f.toLowerCase()} · {i===2?'just joined':'active today'}</small></div><button>{i===2?'Add':'Following'}</button></div>)}</div><button className="outline" onClick={()=>setFriends([...friends,'Nora'])}>＋ Add a friend</button></section>}
 {tab==='profile'&&<section className="profile"><div className="big-avatar">🦄</div><h1>You</h1><p>@you</p><div className="stats"><div><b>{count}</b><span>moments</span></div><div><b>{friends.length}</b><span>friends</span></div><div><b>∞</b><span>memories</span></div></div><div className="note">Your moments stay on this device. ✦</div></section>}
 </main><nav><button className={tab==='wall'?'active':''} onClick={()=>setTab('wall')}><span>◉</span>Wall</button><button className={tab==='friends'?'active':''} onClick={()=>setTab('friends')}><span>♡</span>Friends</button><button className={tab==='capture'?'capture-btn active':''} onClick={()=>setTab('capture')}>＋</button><button className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}><span>○</span>Profile</button></nav></div>
}
createRoot(document.getElementById('root')).render(<App/>);