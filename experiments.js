const lab = {
  tab: 'original', context: null, loopNode: null, loopGain: null, loopAnalyser: null,
  loopStart: 0, loopPhase: 0, loopRate: .5, loopMode: 'compress', loopSweep: null,
  chord: [], chordSweep: null, chordStart: 0, chordPhases: [], chordRates: [],
  renderTimer: null, recording: null, recordPending: false
};
const tracks = [
  {id:0,name:'Table hit',steps:new Set([0,8]),sample:null,sound:'Built-in sound'},
  {id:1,name:'Clap',steps:new Set([4,12,15]),sample:null,sound:'Built-in sound'}
];
let nextTrackId=2;
const voicings = {'13':[48,58,64,69,74],maj:[48,59,64,67,74],alt:[43,53,59,63,68]};
let chordNotes = [...voicings['13']];
const enabled = [true,true,true,true,true];
const voiceColors = [...colors,'#f6d381','#df9ce9'];
const wrap = value => value - Math.floor(value);
const rateOf = id => 2 ** Number(get(id).value);

async function labAudio(){
  lab.context ??= new (window.AudioContext || window.webkitAudioContext)();
  await lab.context.resume();
  return lab.context;
}

document.querySelectorAll('[data-experiment]').forEach(button => {
  button.onclick = () => {
    if (running) toggle(false);
    stopSweep();
    stopLoop();
    stopChord();
    if(lab.recording?.state==='recording')lab.recording.stop();
    lab.tab = button.dataset.experiment;
    document.querySelectorAll('[data-experiment]').forEach(tab => {
      const selected = tab.dataset.experiment === lab.tab;
      tab.setAttribute('aria-pressed', String(selected));
      get(tab.dataset.experiment).hidden = !selected;
    });
  };
});

function defaultHit(index, sampleRate){
  const result = new Float32Array(Math.round(sampleRate*.13));
  let previous = 0;
  for(let i=0;i<result.length;i++){
    const t=i/sampleRate, noise=Math.random()*2-1;
    result[i]=index===0
      ? .9*Math.sin(2*Math.PI*(68*t+2*(1-Math.exp(-38*t))))*Math.exp(-46*t)
      : .45*(noise-previous)*Math.exp(-37*t)*(1+.35*Math.cos(2*Math.PI*100*t));
    previous=noise;
  }
  return result;
}

function renderTracks(){
  lastStep=-1;
  get('loopTracks').replaceChildren();
  for(const track of tracks){
    const id=track.id;
    const row=document.createElement('div');
    row.className='track';
    row.innerHTML=`
      <div class="row track-tools">
        <input class="track-input" id="name${id}" aria-label="Track name" maxlength="40">
        <button id="record${id}">Record mic</button>
        <label>Audio or video <input id="file${id}" type="file" accept="audio/*,video/*,.mov,.mp4,.m4a,.webm"></label>
        <label class="film">Film a hit <input id="camera${id}" type="file" accept="video/*" capture="environment"></label>
        <button id="preview${id}">Preview hit</button>
        <button id="remove${id}">Remove</button>
        <small id="sample${id}"></small>
      </div>
      <div class="steps">${Array.from({length:16},(_,step)=>
        `<button aria-pressed="${track.steps.has(step)}">${step+1}</button>`).join('')}</div>`;
    get('loopTracks').append(row);
    const buttons=[...row.querySelector('.steps').children];
    const updateNames=()=>{
      row.querySelector('.steps').setAttribute('aria-label',track.name+' steps');
      buttons.forEach((button,step)=>button.setAttribute('aria-label',track.name+' step '+(step+1)));
      for(const [prefix,action] of [['record','Record'],['file','Import sound for'],['preview','Preview'],['remove','Remove']])
        get(prefix+id).setAttribute('aria-label',action+' '+track.name);
    };
    get('name'+id).value=track.name;
    get('name'+id).onchange=event=>{
      track.name=event.target.value.trim()||'Track '+(id+1);
      event.target.value=track.name;
      updateNames();
    };
    get('sample'+id).textContent=track.sound;
    get('record'+id).textContent=lab.recordTrack===track?'Stop recording':'Record mic';
    get('preview'+id).disabled=!track.sample&&id>1;
    get('remove'+id).disabled=tracks.length===1;
    updateNames();
    buttons.forEach((button,step)=>{
      button.onclick=()=>{
        if(track.steps.has(step))track.steps.delete(step);else track.steps.add(step);
        button.setAttribute('aria-pressed',String(track.steps.has(step)));
        if(lab.loopNode)rebuildLoop();
      };
    });
    get('record'+id).onclick=()=>recordHit(track);
    get('preview'+id).onclick=()=>previewHit(track);
    get('remove'+id).onclick=()=>{
      if(lab.recordTrack===track){
        get('loopStatus').textContent='Stop recording before removing this track.';
        return;
      }
      tracks.splice(tracks.indexOf(track),1);
      renderTracks();
      if(lab.loopNode)rebuildLoop();
      get('addTrack').focus();
    };
    get('camera'+id).closest('label').hidden=!matchMedia('(pointer: coarse)').matches;
    get('file'+id).onchange=get('camera'+id).onchange=event=>{
      const file=event.target.files[0];
      event.target.value='';
      if(file)loadHit(track,file,file.name);
    };
  }
}
get('addTrack').onclick=()=>{
  const id=nextTrackId++;
  tracks.push({id,name:'Track '+(id+1),steps:new Set(),sample:null,sound:'Choose or record a sound'});
  renderTracks();
  get('name'+id).focus();
};
function soundFor(track,context){
  if(track.sample)return track.sample;
  if(track.id>1)return null;
  track.fallback??=defaultHit(track.id,context.sampleRate);
  return track.fallback;
}
async function previewHit(track){
  try{
    const context=await labAudio();
    const hit=soundFor(track,context);
    if(!hit||lab.tab!=='loop')return;
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=context.createBuffer(1,hit.length,context.sampleRate);
    source.buffer.copyToChannel(hit,0);
    gain.gain.value=.3;
    source.connect(gain);gain.connect(context.destination);
    source.onended=()=>{source.disconnect();gain.disconnect();};
    source.start();
  }catch{get('loopStatus').textContent='Could not preview this hit.';}
}

// Video containers may play in the browser even when decodeAudioData rejects them.
function readVideoSound(context,file){
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video');
    video.playsInline=true;
    const url=URL.createObjectURL(file);
    const source=context.createMediaElementSource(video);
    const processor=context.createScriptProcessor(2048,1,1);
    const silent=context.createGain();
    silent.gain.value=0;
    source.connect(processor);processor.connect(silent);silent.connect(context.destination);
    const capacity=Math.round(context.sampleRate*10);
    const audio=new Float32Array(capacity);
    let length=0,done=false;
    const finish=error=>{
      if(done)return;
      done=true;clearTimeout(timeout);
      video.pause();source.disconnect();processor.disconnect();silent.disconnect();
      processor.onaudioprocess=null;
      URL.revokeObjectURL(url);
      if(error)reject(error);else resolve(audio.subarray(0,length));
    };
    const timeout=setTimeout(()=>finish(new Error('Video timed out')),15000);
    processor.onaudioprocess=event=>{
      const input=event.inputBuffer.getChannelData(0);
      const chunk=input.subarray(0,capacity-length);
      audio.set(chunk,length);length+=chunk.length;
      if(length===capacity)finish();
    };
    video.onended=()=>setTimeout(()=>finish(),60);
    video.onerror=()=>finish(new Error('Unsupported video'));
    video.src=url;
    video.play().catch(finish);
  });
}
async function loadHit(track,blob,label){
  if(!tracks.includes(track))return;
  const attempt=(track.importAttempt??0)+1;
  track.importAttempt=attempt;
  const current=()=>tracks.includes(track)&&track.importAttempt===attempt;
  get('loopStatus').textContent='Reading sound…';
  try{
    const context=await labAudio();
    let source;
    try{
      const decoded=await context.decodeAudioData(await blob.arrayBuffer());
      source=decoded.getChannelData(0);
      if(decoded.numberOfChannels>1){
        source=source.slice();
        for(let channel=1;channel<decoded.numberOfChannels;channel++){
          const input=decoded.getChannelData(channel);
          for(let i=0;i<source.length;i++)source[i]+=input[i];
        }
        for(let i=0;i<source.length;i++)source[i]/=decoded.numberOfChannels;
      }
    }catch(error){
      if(!blob.type.startsWith('video/')&&!/\.(mov|mp4|webm)$/i.test(label))throw error;
      source=await readVideoSound(context,blob);
    }
    if(!current())return;
    let peak=0;
    for(const value of source)peak=Math.max(peak,Math.abs(value));
    if(peak<.0001)throw new Error('Silent audio');
    const threshold=Math.min(.012,peak*.1);
    const first=source.findIndex(value=>Math.abs(value)>=threshold);
    const start=Math.max(0,first-64);
    const hit=source.slice(start,start+Math.round(context.sampleRate*.35));
    const fade=Math.min(96,hit.length);
    for(let i=0;i<fade;i++)hit[hit.length-1-i]*=i/fade;
    track.sample=hit;
    track.sound=label;
    get('sample'+track.id).textContent=label;
    get('preview'+track.id).disabled=false;
    get('loopStatus').textContent='Sound loaded on '+track.name+'.';
    if(lab.loopNode)rebuildLoop();
  }catch{
    if(current())get('loopStatus').textContent='Could not extract an audible hit. Try a short MP4 with sound, a WAV file, or the microphone.';
  }
}

async function recordHit(track){
  if(lab.recording){if(lab.recording.state==='recording')lab.recording.stop();return;}
  if(lab.recordPending)return;
  lab.recordPending=true;
  let stream;
  try{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error();
    stopLoop();
    await labAudio();
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(lab.tab!=='loop'||!tracks.includes(track)){stream.getTracks().forEach(track=>track.stop());return;}
    const recorder=new MediaRecorder(stream);
    const chunks=[];
    lab.recording=recorder;
    lab.recordTrack=track;
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      stream.getTracks().forEach(track=>track.stop());
      lab.recording=null;
      lab.recordTrack=null;
      get('record'+track.id).textContent='Record mic';
      if(chunks.length)loadHit(track,new Blob(chunks,{type:recorder.mimeType}),'Recorded sound');
    };
    recorder.start();
    get('record'+track.id).textContent='Stop recording';
    get('loopStatus').textContent='Make one sound now. Recording stops after three seconds.';
    setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},3000);
  }catch{
    stream?.getTracks().forEach(track=>track.stop());
    get('loopStatus').textContent='Microphone unavailable. You can load an audio file instead.';
  }finally{lab.recordPending=false;}
}

// Fold every hit into one periodic buffer, including tails across the loop boundary.
function makeLoop(context,period){
  const length=Math.max(1,Math.round(context.sampleRate*period));
  const buffer=context.createBuffer(1,length,context.sampleRate);
  const data=buffer.getChannelData(0);
  tracks.forEach(track=>{
    if(!track.steps.size)return;
    const hit=soundFor(track,context);
    if(!hit)return;
    for(const step of track.steps){
      const offset=Math.round(step*length/16);
      for(let i=0;i<hit.length;i++)data[(offset+i)%length]+=hit[i];
    }
  });
  let maximum=1;
  for(const value of data)maximum=Math.max(maximum,Math.abs(value));
  if(maximum>1)for(let i=0;i<data.length;i++)data[i]/=maximum;
  return buffer;
}

function loopPosition(now){
  return wrap(lab.loopPhase+(now-lab.loopStart)*lab.loopRate);
}
function rebuildLoop(){
  clearTimeout(lab.renderTimer);lab.renderTimer=null;
  const context=lab.context;
  const now=context.currentTime;
  const phase=lab.loopNode?loopPosition(now):0;
  const rate=rateOf('loopRate');
  const mode=get('loopMode').value;
  const period=mode==='compress'?2:1/rate;
  const source=context.createBufferSource();
  source.buffer=makeLoop(context,period);
  source.loop=true;
  source.playbackRate.value=source.buffer.duration*rate;
  source.connect(lab.loopGain);
  source.onended=()=>source.disconnect();
  source.start(now,phase*source.buffer.duration);
  if(lab.loopNode)lab.loopNode.stop(now);
  Object.assign(lab,{loopNode:source,loopPhase:phase,loopStart:now,loopRate:rate,loopMode:mode});
}
function updateLoopRate(){
  const rate=rateOf('loopRate');
  get('loopRead').textContent=rate.toFixed(rate<10?2:1)+' Hz';
  if(!lab.loopNode)return;
  if(lab.loopMode==='compress'){
    const now=lab.context.currentTime;
    lab.loopPhase=loopPosition(now);
    lab.loopStart=now;
    lab.loopRate=rate;
    lab.loopNode.playbackRate.setValueAtTime(rate*lab.loopNode.buffer.duration,now);
  }else if(!lab.renderTimer){
    lab.renderTimer=setTimeout(()=>{lab.renderTimer=null;if(lab.loopNode)rebuildLoop();},70);
  }
}
async function playLoop(){
  try{
    const context=await labAudio();
    if(lab.tab!=='loop'||lab.loopNode)return;
    if(!lab.loopGain){
      lab.loopGain=context.createGain();
      lab.loopGain.gain.value=.20;
      lab.loopAnalyser=context.createAnalyser();
      lab.loopAnalyser.fftSize=8192;
      lab.loopGain.connect(lab.loopAnalyser);
      lab.loopAnalyser.connect(context.destination);
    }
    rebuildLoop();
    get('loopPlay').textContent='■ Stop loop';
    get('loopStatus').textContent='';
  }catch{get('loopStatus').textContent='Audio could not start.';}
}
function stopLoop(){
  lab.loopSweep=null;
  clearTimeout(lab.renderTimer);lab.renderTimer=null;
  if(lab.loopNode){lab.loopNode.stop();lab.loopNode=null;}
  get('loopPlay').textContent='▶ Play loop';
  updateSweepLabel('loop');
  document.querySelectorAll('.steps .current').forEach(button=>button.classList.remove('current'));
}
get('loopPlay').onclick=()=>lab.loopNode?stopLoop():playLoop();
get('loopRate').oninput=()=>{lab.loopSweep=null;updateLoopRate();updateSweepLabel('loop');};
get('loopMode').onchange=()=>{if(lab.loopNode)rebuildLoop();};

function ratiosForChord(){
  const root=pitch(chordNotes[0]);
  return chordNotes.map(note=>{
    const value=pitch(note)/root;
    if(!get('rational').checked)return value;
    let best=value,error=Infinity;
    for(let denominator=1;denominator<=8;denominator++){
      const candidate=Math.round(value*denominator)/denominator;
      const distance=Math.abs(Math.log2(candidate/value));
      if(distance<error){error=distance;best=candidate;}
    }
    return best;
  });
}
function advanceChord(now){
  const elapsed=now-lab.chordStart;
  lab.chordPhases=lab.chordPhases.map((phase,index)=>wrap(phase+elapsed*lab.chordRates[index]));
  lab.chordStart=now;
}
function updateChordRate(){
  const base=rateOf('chordRate');
  const ratios=ratiosForChord();
  if(lab.chord.length)advanceChord(Math.max(lab.chordStart,lab.context.currentTime));
  lab.chordRates=ratios.map(ratio=>base*ratio);
  get('chordRead').textContent=base.toFixed(base<10?2:1)+' Hz';
  lab.chordRates.forEach((rate,index)=>{
    get('chordHz'+index).textContent=rate.toFixed(rate<10?2:1)+' Hz';
    if(lab.chord.length){
      const {tone,gain}=lab.chord[index];
      tone.frequency.setValueAtTime(rate,lab.context.currentTime);
      gain.gain.setTargetAtTime(enabled[index]?.045:0,lab.context.currentTime,.015);
    }
  });
  get('chordCycle').textContent=get('rational').checked
    ? 'Simple ratios: '+ratios.map(ratio=>{
      for(let d=1;d<=8;d++)if(Math.abs(ratio*d-Math.round(ratio*d))<1e-8)return Math.round(ratio*d)+'/'+d;
    }).join(' · ')+'. Toggling tuning during playback preserves phase. Start the voicing again to align the first pulses.'
    : 'Equal-tempered notes keep their tuning. Their pulses can drift relative to one another.';
}
function renderChord(){
  const options=Array.from({length:49},(_,index)=>36+index).map(note=>`<option value="${note}">${noteName(note)}</option>`).join('');
  get('chordVoices').innerHTML=chordNotes.map((note,index)=>`<div style="border-left:3px solid ${voiceColors[index]};padding-left:7px">
    <label>Voice ${index+1}<select id="chordNote${index}">${options}</select></label>
    <label style="display:block"><input type="checkbox" id="chordVoice${index}"> Play</label><output id="chordHz${index}"></output></div>`).join('');
  chordNotes.forEach((note,index)=>{
    get('chordNote'+index).value=note;
    get('chordVoice'+index).checked=enabled[index];
    get('chordVoice'+index).onchange=event=>{enabled[index]=event.target.checked;updateChordRate();};
    get('chordNote'+index).onchange=event=>{
      chordNotes[index]=Number(event.target.value);
      get('voicing').value='custom';
      updateChordRate();
    };
  });
  updateChordRate();
}
async function playChord(){
  try{
    const context=await labAudio();
    if(lab.tab!=='chord'||lab.chord.length)return;
    const real=new Float32Array(97),imag=new Float32Array(97);
    for(let harmonic=1;harmonic<real.length;harmonic++)real[harmonic]=Math.exp(-.5*(2*Math.PI*harmonic*.012)**2);
    const wave=context.createPeriodicWave(real,imag);
    const start=context.currentTime+.035;
    lab.chordStart=start;
    lab.chordPhases=chordNotes.map(()=>0);
    lab.chord=chordNotes.map((_,index)=>{
      const tone=context.createOscillator(),gain=context.createGain();
      tone.setPeriodicWave(wave);
      tone.frequency.value=lab.chordRates[index];
      gain.gain.value=enabled[index]?.045:0;
      tone.connect(gain);gain.connect(context.destination);
      tone.start(start);
      return {tone,gain};
    });
    get('chordPlay').textContent='■ Stop voicing';
    get('chordStatus').textContent='';
  }catch{get('chordStatus').textContent='Audio could not start.';}
}
function stopChord(){
  lab.chordSweep=null;
  lab.chord.forEach(({tone,gain})=>{
    const now=lab.context.currentTime;
    gain.gain.setTargetAtTime(0,now,.012);
    tone.stop(now+.06);
    tone.onended=()=>{tone.disconnect();gain.disconnect();};
  });
  lab.chord=[];
  get('chordPlay').textContent='▶ Play voicing';
  updateSweepLabel('chord');
}
get('chordPlay').onclick=()=>lab.chord.length?stopChord():playChord();
get('chordRate').oninput=()=>{lab.chordSweep=null;updateChordRate();updateSweepLabel('chord');};
get('rational').onchange=updateChordRate;
get('voicing').onchange=event=>{
  const notes=voicings[event.target.value];
  if(notes){chordNotes=[...notes];renderChord();}
};

function updateSweepLabel(kind){
  get(kind+'Sweep').textContent=rateOf(kind+'Rate')>=(kind==='loop'?12:20)?'Sweep to rhythm':'Sweep to pitch';
}
for(const kind of ['loop','chord']){
  get(kind+'Sweep').onclick=async()=>{
    if(lab[kind+'Sweep']){lab[kind+'Sweep']=null;updateSweepLabel(kind);return;}
    await (kind==='loop'?playLoop():playChord());
    if(lab.tab!==kind||!(kind==='loop'?lab.loopNode:lab.chord.length))return;
    const from=Number(get(kind+'Rate').value);
    const slow=kind==='loop'?.5:2,fast=kind==='loop'?110:pitch(chordNotes[0]);
    lab[kind+'Sweep']={from,to:Math.log2(rateOf(kind+'Rate')>=(kind==='loop'?12:20)?slow:fast),start:performance.now()};
    get(kind+'Sweep').textContent='Cancel sweep';
  };
}

let lastStep=-1;
function drawLoop(){
  const step=lab.loopNode&&lab.loopRate<=4?Math.floor(loopPosition(lab.context.currentTime)*16):-1;
  if(step!==lastStep){
    document.querySelectorAll('.steps').forEach(row=>[...row.children].forEach((button,index)=>button.classList.toggle('current',index===step)));
    lastStep=step;
  }
  const {ctx,w,h}=surface('loopSpectrum');
  if(w<40)return;
  const left=24,right=w-18,baseline=h-23;
  const xFor=f=>left+Math.log10(f/10)/3*(right-left);
  ctx.textAlign='center';
  for(const hz of [10,100,1000,10000]){
    const x=xFor(hz);
    ctx.fillStyle='#414c61';ctx.fillRect(x,10,1,baseline-10);
    ctx.fillStyle='#aeb8ca';ctx.fillText(hz>=1000?hz/1000+'k':hz,x,h-6);
  }
  const rate=lab.loopNode?lab.loopRate:rateOf('loopRate');
  if(rate>=10){
    ctx.strokeStyle='#738459';ctx.setLineDash([4,4]);
    ctx.beginPath();
    for(let n=1;n<=12&&n*rate<=10000;n++){
      const x=xFor(n*rate);ctx.moveTo(x,12);ctx.lineTo(x,baseline);
    }
    ctx.stroke();ctx.setLineDash([]);
  }
  if(!lab.loopNode)return;
  const analyser=lab.loopAnalyser;
  lab.loopBins??=new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(lab.loopBins);
  ctx.strokeStyle='#e9edf7';ctx.beginPath();
  for(let x=left;x<=right;x++){
    const hz=10*10**(3*(x-left)/(right-left));
    const db=lab.loopBins[Math.round(hz*analyser.fftSize/lab.context.sampleRate)]??-Infinity;
    const y=baseline-Math.max(0,Math.min(1,(db+100)/80))*(baseline-10);
    if(x===left)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.stroke();
}
function drawChord(){
  const {ctx,w,h}=surface('chordTimeline');
  if(w<80)return;
  const base=rateOf('chordRate'),seconds=Math.min(2,6/base);
  const left=45,right=w-12,nowX=left+(right-left)*.25;
  const running=lab.chord.length>0;
  const elapsed=running?Math.max(0,lab.context.currentTime-lab.chordStart):0;
  const xFor=time=>nowX+time/seconds*(right-left);
  ctx.fillStyle='#e9edf7';ctx.fillRect(nowX,9,1,h-32);
  chordNotes.forEach((note,index)=>{
    const y=22+index*34,rate=lab.chordRates[index];
    ctx.fillStyle=enabled[index]?voiceColors[index]:'#8790a1';
    ctx.fillText(noteName(note),4,y+4);
    ctx.fillStyle='#414c61';ctx.fillRect(left,y,right-left,1);
    if(!enabled[index])return;
    const phase=running?wrap(lab.chordPhases[index]+elapsed*rate):0;
    const first=Math.ceil(phase-rate*seconds*.25),last=Math.floor(phase+rate*seconds*.75);
    ctx.fillStyle=voiceColors[index];
    for(let n=first;n<=last;n++){
      const x=xFor((n-phase)/rate);
      ctx.beginPath();ctx.arc(x,y,3.2,0,2*Math.PI);ctx.fill();
    }
  });
  ctx.fillStyle='#aeb8ca';ctx.textAlign='center';ctx.fillText('Now',nowX,h-8);
  ctx.textAlign='right';
  const future=seconds*.75;
  ctx.fillText(future<1?'+'+Math.round(future*1000)+' ms':'+'+future.toFixed(2)+' s',right,h-8);
}
function renderLab(now){
  const kind=lab.tab;
  if(kind!=='original'){
    const sweep=lab[kind+'Sweep'];
    if(sweep){
      const progress=Math.min(1,(now-sweep.start)/8000);
      get(kind+'Rate').value=sweep.from+(sweep.to-sweep.from)*progress;
      if(kind==='loop')updateLoopRate();else updateChordRate();
      if(progress===1){lab[kind+'Sweep']=null;updateSweepLabel(kind);}
    }
    if(kind==='loop')drawLoop();else drawChord();
  }
  requestAnimationFrame(renderLab);
}
renderTracks();
get('chordRate').value=Math.log2(pitch(chordNotes[0]));
renderChord();
updateLoopRate();
updateSweepLabel('loop');
updateSweepLabel('chord');
requestAnimationFrame(renderLab);
