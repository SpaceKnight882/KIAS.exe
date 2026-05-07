import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");
const PAGES_PATH = path.join(STORAGE_DIR, "pages.json");
const MEMORY_PATH = path.join(ROOT, "db.json");

const TARGETS = ["home","about","divisions","innovation","careers","investors","newsroom","contact","company_info","lab_reports","testing","containment","watchlist","journal","kias","nothing_is_lost_forever"];
const ROLES = ["viewer", "author", "editor", "moderator", "admin", "super_admin"];
const DEFAULT_PERMISSIONS = {
  viewer: ["posts:read", "dashboard:read"],
  author: ["posts:read", "posts:create", "posts:update:own", "dashboard:read", "profile:update:own", "settings:update:own"],
  editor: ["posts:read", "posts:create", "posts:update:any", "posts:publish", "dashboard:read", "templates:edit"],
  moderator: ["posts:read", "posts:moderate", "dashboard:read", "templates:edit"],
  admin: ["*"],
  super_admin: ["*"]
};
const ROUTE_TARGET_MAP = {"/":"home","/about":"about","/divisions":"divisions","/innovation":"innovation","/careers":"careers","/investors":"investors","/newsroom":"newsroom","/contact":"contact","/company-info":"company_info","/lab-reports":"lab_reports","/testing":"testing","/containment":"containment","/watchlist":"watchlist","/journal":"journal","/kias":"kias","/nothing-is-lost-forever":"nothing_is_lost_forever"};

app.use(express.json({ limit: "50mb" }));

const readJson = (f,fb)=>{try{return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):fb}catch{return fb}};
const writeJson = (f,d)=>fs.writeFileSync(f, JSON.stringify(d,null,2));
const sanitizeFileName=(n="")=>String(n).replace(/[^a-zA-Z0-9._-]/g,"_")||`file_${Date.now()}`;
const nowISO=()=>new Date().toISOString();
const uid=(pfx="id")=>`${pfx}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
const hashPassword=(password,salt=crypto.randomBytes(16).toString("hex"))=>{const h=crypto.pbkdf2Sync(password,salt,120000,64,'sha512').toString('hex');return `${salt}:${h}`};
const verifyPassword=(password,stored="")=>{const [salt,hash]=String(stored).split(':'); if(!salt||!hash) return false; const compare=crypto.pbkdf2Sync(password,salt,120000,64,'sha512').toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(compare));};
const token=()=>crypto.randomBytes(32).toString("hex");

function ensureStorage(){
  if(!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR,{recursive:true});
  if(!fs.existsSync(INDEX_PATH)) writeJson(INDEX_PATH,{files:[]});
  if(!fs.existsSync(PAGES_PATH)) writeJson(PAGES_PATH,{home:""});
  if(!fs.existsSync(MEMORY_PATH)) writeJson(MEMORY_PATH,{});
  const db = readJson(MEMORY_PATH, {});
  db.users ??= {};
  db.sessions ??= {};
  db.passwordResets ??= {};
  db.posts ??= [];
  db.blogTemplates ??= [];
  db.rolePermissions ??= DEFAULT_PERMISSIONS;
  db.logs ??= [];
  db.ai ??= {responses:[], interactions:[]};
  writeJson(MEMORY_PATH, db);
}
ensureStorage();
const dbRead=()=>readJson(MEMORY_PATH,{});
const dbWrite=(db)=>writeJson(MEMORY_PATH,db);

function getUserSafe(user){ if(!user) return null; const {passwordHash,...safe}=user; return safe; }
function isRole(r){return ROLES.includes(r)}
function hasPermission(user, perm){ if(!user) return false; const perms = user.permissions || dbRead().rolePermissions?.[user.role] || []; return perms.includes('*') || perms.includes(perm); }
function auth(req,res,next){ const header=req.headers.authorization||""; const sessionToken=header.startsWith("Bearer ")?header.slice(7):req.headers['x-session-token']; if(!sessionToken) return res.status(401).json({error:'Authentication required'}); const db=dbRead(); const sess=db.sessions?.[sessionToken]; if(!sess||Date.now()>Number(sess.expiresAt||0)) return res.status(401).json({error:'Session expired'}); const user=db.users[sess.userId]; if(!user) return res.status(401).json({error:'User not found'}); req.session={token:sessionToken,...sess}; req.user=user; req.db=db; next(); }
function requirePerm(perm){ return (req,res,next)=> hasPermission(req.user, perm)||hasPermission(req.user,'*') ? next() : res.status(403).json({error:'Insufficient permissions'}); }

function normalizeFile(file={}){return {id:file.id||uid('file'),name:sanitizeFileName(file.name||'file'),originalName:file.originalName||file.name||'',target:TARGETS.includes(file.target)?file.target:null,type:file.type||'binary',mime:file.mime||'application/octet-stream',size:Number(file.size||0),uploadedAt:file.uploadedAt||nowISO(),path:file.path||`storage/${sanitizeFileName(file.name||'file')}`,description:typeof file.description==='string'?file.description:'',tags:Array.isArray(file.tags)?file.tags:[],encoding:file.encoding||'base64',updatedAt:file.updatedAt||null}};
const indexData=()=>({files:(readJson(INDEX_PATH,{files:[]}).files||[]).map(normalizeFile)});
const saveIndex=(d)=>writeJson(INDEX_PATH,{files:(d.files||[]).map(normalizeFile)});
const pagesData=()=>readJson(PAGES_PATH,{});
const savePages=(p)=>writeJson(PAGES_PATH,p);

app.post('/api/auth/register',(req,res)=>{
  const {email, username, password, displayName} = req.body||{};
  if(!password || password.length<8) return res.status(400).json({error:'Password must be at least 8 characters'});
  if(!email && !username) return res.status(400).json({error:'Email or username required'});
  const db=dbRead();
  const existing=Object.values(db.users).find(u=>(email && u.email?.toLowerCase()===String(email).toLowerCase())||(username&&u.username?.toLowerCase()===String(username).toLowerCase()));
  if(existing) return res.status(409).json({error:'User already exists'});
  const id=uid('user');
  db.users[id]={id,email:email||null,username:username||`user_${id.slice(-6)}`,displayName:displayName||username||email||'User',passwordHash:hashPassword(password),role:'viewer',permissions:db.rolePermissions.viewer,createdAt:nowISO(),profile:{bio:'',avatarUrl:'',bannerUrl:'',socialLinks:[]},settings:{theme:'dark',accent:'#33d777',font:'Inter',layout:'default',widgets:{},wallpaper:{type:'color',value:'#040812'},accessibility:{reducedMotion:false,fontScale:1},audio:{enabled:true,weatherSfx:false,radioVolume:70},mobile:{bottomNav:true}},dashboard:{favorites:[],recentWidgets:[],layout:[]}};
  dbWrite(db);
  res.json({message:'Registered', user:getUserSafe(db.users[id])});
});
app.post('/api/auth/login',(req,res)=>{ const {identity,password,rememberMe=false,guest=false}=req.body||{}; const db=dbRead(); if(guest){const id=uid('guest'); db.users[id]={id,username:id,displayName:'Guest',role:'viewer',permissions:db.rolePermissions.viewer,passwordHash:hashPassword(token()),createdAt:nowISO(),profile:{bio:''},settings:{theme:'dark'}}; const t=token(); db.sessions[t]={userId:id,createdAt:Date.now(),expiresAt:Date.now()+(6*60*60*1000),rememberMe:false}; dbWrite(db); return res.json({token:t,user:getUserSafe(db.users[id])}); }
  const user=Object.values(db.users).find(u=>u.email===identity||u.username===identity); if(!user||!verifyPassword(password||'',user.passwordHash)) return res.status(401).json({error:'Invalid credentials'});
  const t=token(); db.sessions[t]={userId:user.id,createdAt:Date.now(),expiresAt:Date.now()+(rememberMe?30:1)*24*60*60*1000,rememberMe:Boolean(rememberMe)}; dbWrite(db); res.json({token:t,user:getUserSafe(user)}); });
app.post('/api/auth/logout',auth,(req,res)=>{ delete req.db.sessions[req.session.token]; dbWrite(req.db); res.json({message:'Logged out'});});
app.post('/api/auth/reset/request',(req,res)=>{const {identity}=req.body||{}; const db=dbRead(); const user=Object.values(db.users).find(u=>u.email===identity||u.username===identity); if(!user) return res.json({message:'If the account exists, a reset token has been created.'}); const rt=token(); db.passwordResets[rt]={userId:user.id,expiresAt:Date.now()+15*60*1000}; dbWrite(db); res.json({message:'Reset token generated', resetToken:rt});});
app.post('/api/auth/reset/confirm',(req,res)=>{const {resetToken,newPassword}=req.body||{}; const db=dbRead(); const rec=db.passwordResets?.[resetToken]; if(!rec||Date.now()>rec.expiresAt) return res.status(400).json({error:'Invalid reset token'}); if(!newPassword||newPassword.length<8) return res.status(400).json({error:'Password too short'}); const user=db.users[rec.userId]; user.passwordHash=hashPassword(newPassword); delete db.passwordResets[resetToken]; dbWrite(db); res.json({message:'Password updated'});});

app.get('/api/me',auth,(req,res)=>res.json({user:getUserSafe(req.user)}));
app.put('/api/me/profile',auth,(req,res)=>{const {bio,displayName,avatarUrl,bannerUrl,socialLinks}=req.body||{}; req.user.profile={...req.user.profile,bio:bio??req.user.profile?.bio??'',avatarUrl:avatarUrl??req.user.profile?.avatarUrl??'',bannerUrl:bannerUrl??req.user.profile?.bannerUrl??'',socialLinks:Array.isArray(socialLinks)?socialLinks:req.user.profile?.socialLinks??[]}; if(displayName) req.user.displayName=displayName; dbWrite(req.db); res.json({user:getUserSafe(req.user)});});
app.put('/api/me/settings',auth,(req,res)=>{const incoming=req.body?.settings; if(!incoming||typeof incoming!=='object') return res.status(400).json({error:'settings object required'}); req.user.settings={...(req.user.settings||{}),...incoming,updatedAt:nowISO()}; dbWrite(req.db); res.json({settings:req.user.settings, autosave:true});});

app.get('/api/posts',auth,(req,res)=>{const posts=(req.db.posts||[]).filter(p=>p.status==='published' || p.authorId===req.user.id || hasPermission(req.user,'posts:update:any')).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)); res.json({posts});});
app.post('/api/posts',auth,requirePerm('posts:create'),(req,res)=>{const {title,content,status='draft',tags=[]}=req.body||{}; if(!title||!content) return res.status(400).json({error:'title and content required'}); const canPublish=hasPermission(req.user,'posts:publish'); const finalStatus=status==='published'&&canPublish?'published':'draft'; const p={id:uid('post'),authorId:req.user.id,authorName:req.user.displayName||req.user.username,title,content,status:finalStatus,tags,createdAt:nowISO(),updatedAt:nowISO()}; req.db.posts.push(p); dbWrite(req.db); res.json({post:p});});

app.put('/api/admin/users/:userId/role',auth,requirePerm('*'),(req,res)=>{const u=req.db.users[req.params.userId]; if(!u) return res.status(404).json({error:'User not found'}); const role=req.body?.role; if(!isRole(role)) return res.status(400).json({error:'Invalid role'}); u.role=role; u.permissions=req.db.rolePermissions[role]||[]; dbWrite(req.db); res.json({user:getUserSafe(u)});});
app.put('/api/admin/roles/:role',auth,requirePerm('*'),(req,res)=>{const role=req.params.role; if(!isRole(role)) return res.status(400).json({error:'Invalid role'}); const permissions=Array.isArray(req.body?.permissions)?req.body.permissions:[]; req.db.rolePermissions[role]=permissions; Object.values(req.db.users).forEach(u=>{if(u.role===role)u.permissions=permissions;}); dbWrite(req.db); res.json({role,permissions});});

app.get('/api/templates',auth,(req,res)=>res.json({templates:req.db.blogTemplates||[]}));
app.post('/api/templates/:id/customize',auth,(req,res)=>{const base=(req.db.blogTemplates||[]).find(t=>t.id===req.params.id); if(!base) return res.status(404).json({error:'Template not found'}); const custom={...base,...(req.body?.customizations||{}),id:uid('template'),sourceTemplateId:base.id,ownerId:req.user.id,updatedAt:nowISO()}; req.db.blogTemplates.push(custom); dbWrite(req.db); res.json({template:custom,preview:true});});

Object.entries(ROUTE_TARGET_MAP).forEach(([route,target])=>{app.get(route,(_req,res,next)=>{if(route==='/'&&_req.path!=='/')return next();const pages=pagesData();const content=pages[target];if(typeof content==='string'&&content.trim())return res.type('html').send(content);const fallbackFile=target==='home'?'index.html':target==='kias'?'kias.html':target==='nothing_is_lost_forever'?'nothing-is-lost-forever.html':`${target.replace('_','-')}.html`;const rootFallback=path.join(ROOT,fallbackFile);if(fs.existsSync(rootFallback))return res.sendFile(rootFallback);return res.status(404).send(`No content found for target '${target}'.`);});});

app.get('/health',(_req,res)=>res.json({ok:true}));
app.use('/storage', express.static(STORAGE_DIR));
app.listen(PORT,()=>console.log(`K.I.A.S admin system running on port ${PORT}`));
