import type { Draft } from './project';
export type Bundle = {
  drafts: { name: string; draft: Draft }[];
  files: { path: string; sha256: string; bytes: number }[];
};

// Self-contained: this exact function also runs inside the downloaded offline installer.
export function prepareInstallation(
  draft: Draft,
  template: Record<string, any>,
  metadata: Record<string, any>,
  folderName: string,
  paths: Record<string, string>,
) {
  if (
    !template ||
    !Array.isArray(template.tracks) ||
    template.tracks.some((t: any) => !Array.isArray(t.segments) || t.segments.length)
  )
    throw new Error(
      'Choose a newly created, empty CapCut project. Existing edits will not be overwritten.',
    );
  if (!template.id || !template.platform || !template.materials || !metadata.draft_id)
    throw new Error('This folder is not a supported CapCut desktop draft.');
  const absolute = String(metadata.draft_fold_path || '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  if (!/^(?:[A-Za-z]:\/|\/)/.test(absolute) || absolute.split('/').at(-1) !== folderName)
    throw new Error(
      'CapCut did not record a usable project location. Reopen and close the new empty draft, then try again.',
    );
  function rewrite(value: any): any {
    if (typeof value === 'string') return paths[value] || value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    return value;
  }
  const incoming = rewrite(draft),
    content = structuredClone(template),
    meta = structuredClone(metadata);
  // Keep the actual app's version, platform, ID and project settings.
  content.name = incoming.content.name;
  content.duration = incoming.content.duration;
  content.fps = incoming.content.fps;
  content.canvas_config = incoming.content.canvas_config;
  content.tracks = incoming.content.tracks;
  content.materials = Object.fromEntries(Object.keys(content.materials).map((k) => [k, []]));
  Object.assign(content.materials, incoming.content.materials);
  content.keyframes = incoming.content.keyframes;
  content.keyframe_graph_list = [];
  content.relationships = [];
  content.update_time = Date.now() * 1000;
  meta.draft_name = content.name;
  meta.tm_duration = content.duration;
  meta.tm_draft_modified = Date.now() * 1000;
  meta.draft_materials = incoming.meta.draft_materials;
  return { content, meta };
}
export function installerHTML(bundle: Bundle) {
  const data = JSON.stringify(bundle)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reel Studio → CapCut desktop</title>
<style>body{font:16px/1.65 system-ui;background:#f7f8f1;color:#30402d;margin:0}main{max-width:680px;margin:40px auto;padding:28px;background:white;border-radius:14px}button,select{font:inherit;padding:12px;margin:8px 0;max-width:100%}button{cursor:pointer;background:#e7eedf;border:1px solid #a6b58f;border-radius:7px}small{display:block}#status{white-space:pre-wrap;padding:14px;background:#f5f7ef}h1{font-size:26px}</style>
<main><h1>Reopen your reel in CapCut desktop</h1><p>Experimental local draft transfer for Windows/Mac. Use Chrome or Edge on your computer. Nothing is uploaded.</p>
<ol><li>Extract the entire downloaded ZIP to a folder.</li><li>In CapCut desktop, create a <strong>new empty project</strong>. Find its folder using CapCut’s project location/settings. Quit CapCut completely.</li><li>Select the extracted export folder below, then select that empty CapCut project folder. Existing edits are never replaced.</li></ol>
<label>Reel <select id="reel"></select></label><br><button id="bundle">1. Choose extracted export folder</button><br><button id="install" disabled>2. Choose empty CapCut project and install</button>
<p id="status" role="status">Select the folder containing this HTML file and the media folder.</p><p>Once installed, reopen the same project in CapCut. Cuts, source media, basic text, static framing and music remain editable. Recheck fonts, framing and sound. Motion, caption animations, SFX and automatic music ducking need to be recreated.</p><p>If this CapCut version uses encrypted drafts or a different layout, installation stops. Keep your MP4 and mobile remaster pack as alternatives. CapCut mobile/web cannot open this generated desktop draft.</p><small>A backup of the empty draft is saved inside its folder before any draft file changes.</small></main>
<script>
const bundle=${data};
const prepare=${prepareInstallation.toString()};
let source; const status=document.getElementById('status'), install=document.getElementById('install'), chooser=document.getElementById('bundle');
for (const [i,item] of bundle.drafts.entries()) {const o=document.createElement('option');o.value=String(i);o.textContent=item.name;document.getElementById('reel').append(o);}
async function read(root,path) {const bits=path.split('/');if(bits.some(p=>!p||p==='.'||p==='..'))throw Error('Invalid bundle path');for(const b of bits.slice(0,-1))root=await root.getDirectoryHandle(b);return await (await root.getFileHandle(bits.at(-1))).getFile();}
async function write(root,name,data){const parts=name.split('/');for(const part of parts.slice(0,-1)){if(!part||part==='..'||part==='.')throw Error('Invalid output path');root=await root.getDirectoryHandle(part,{create:true});}name=parts.at(-1);const h=await root.getFileHandle(name,{create:true}),w=await h.createWritable();try{await w.write(data);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
chooser.onclick=async()=>{try{if(!window.showDirectoryPicker)throw Error('Use desktop Chrome or Edge to install. This browser does not offer folder access.');source=await window.showDirectoryPicker({mode:'read'});if(bundle.files.reduce((n,f)=>n+f.bytes,0)>210*1024*1024)throw Error('Bundle exceeds its size budget.');for(const f of bundle.files){const file=await read(source,f.path);if(file.size!==f.bytes)throw Error('The selected export folder is missing or has changed media.');}install.disabled=false;status.textContent='Export folder selected. Choose your new empty CapCut project folder next.';}catch(e){source=undefined;install.disabled=true;status.textContent=e.message;}};
install.onclick=async()=>{let root, originals=[], changed=[];install.disabled=true;chooser.disabled=true;try{
 root=await window.showDirectoryPicker({mode:'readwrite'});const metaFile=await read(root,'draft_meta_info.json'),metaText=await metaFile.text(),meta=JSON.parse(metaText);const folder=String(meta.draft_fold_path||'').replace(/\\\\/g,'/').replace(/\\/$/,'');
 const draft=bundle.drafts[Number(document.getElementById('reel').value)];const stamp=crypto.randomUUID(),sub='ReelStudio-media/'+stamp,paths={};
 for(const f of bundle.files)paths[f.path]=folder+'/'+sub+'/'+f.path.split('/').at(-1);
 async function collect(prefix){for(const fileName of ['draft_content.json','draft_info.json']){const name=prefix+fileName;let file;try{file=await read(root,name);}catch(e){if(e.name==='NotFoundError')continue;throw e;}const text=await file.text();const prepared=prepare(draft.draft,JSON.parse(text),meta,root.name,paths);originals.push({name,text,next:JSON.stringify(prepared.content,null,2)});}}
 await collect('');if(!originals.length)throw Error('No readable desktop draft was found.');
 for(const name of ['Timelines','timelines']){try{const h=await root.getDirectoryHandle(name);let count=0;for await(const entry of h.values()){if(entry.kind==='directory'){if(++count>4)throw Error('Too many timelines in this project. Choose a new empty draft.');const before=originals.length;await collect(name+'/'+entry.name+'/');if(before===originals.length)throw Error('Unsupported timeline layout. No draft files were changed.');}}}catch(e){if(e.name!=='NotFoundError')throw e;}}
 const nextMeta=prepare(draft.draft,JSON.parse(originals[0].text),meta,root.name,paths).meta;
 for(const f of bundle.files){const file=await read(source,f.path);if(await digest(file)!==f.sha256)throw Error('A source file changed. Download a new export.');}
 const backup=await root.getDirectoryHandle('ReelStudio-backup-'+stamp,{create:true});for(const f of originals)await write(backup,f.name,f.text);await write(backup,'draft_meta_info.json',metaText);originals.push({name:'draft_meta_info.json',text:metaText,next:JSON.stringify(nextMeta,null,2)});
 let media=await root.getDirectoryHandle('ReelStudio-media',{create:true});media=await media.getDirectoryHandle(stamp,{create:true});for(const f of bundle.files)await write(media,f.path.split('/').at(-1),await read(source,f.path));
 for(const f of originals){changed.push(f);await write(root,f.name,f.next);}
 status.textContent='Installed. Reopen the same project in CapCut desktop. Review the timeline before editing further. Backup: ReelStudio-backup-'+stamp;
 }catch(e){let failed=false;for(const f of changed.reverse()){try{await write(root,f.name,f.text);}catch(_){failed=true;}}status.textContent=e.message+(failed?' Restore the empty draft files from the ReelStudio-backup folder before reopening.':' No existing edits were replaced.');}finally{install.disabled=!source;chooser.disabled=false;}};
</script></html>`;
}
