/*
 * LAND:15 DOM adapter for the Dock published on 21st.dev by ibelick.
 * Dock distance interpolation, spring settings, and tooltip timing are ported
 * from https://github.com/ibelick/motion-primitives/blob/main/components/core/dock.tsx
 * Copyright (c) 2024 ibelick — MIT. Full notice in vendor/ui/README.md.
 * Expandable labels are an original DOM implementation of the publicly visible
 * 21st.dev Victor Welander Expandable Tabs behavior. Its source was gated; no
 * gated source was obtained or represented as copied.
 */

export const DOCK_SPRING = Object.freeze({mass:0.1,stiffness:150,damping:12});
export const DOCK_DEFAULTS = Object.freeze({distance:150,base:40,magnification:80});

// Direct port of useTransform([-distance,0,distance],[40,magnification,40]).
export function dockTarget(pointerDistance,{distance=150,base=40,magnification=80}={}) {
  if(!Number.isFinite(pointerDistance))return base;
  return base+(magnification-base)*Math.max(0,1-Math.abs(pointerDistance)/distance);
}

// A dependency-free numerical replacement for Motion's useSpring. Substeps
// preserve the original physical spring settings without unstable long frames.
export function advanceSpring(value,velocity,target,seconds,spring=DOCK_SPRING) {
  let remaining=Math.min(Math.max(seconds,0),0.05);
  while(remaining>0){const dt=Math.min(remaining,1/240);
    const acceleration=(-spring.stiffness*(value-target)-spring.damping*velocity)/spring.mass;
    velocity+=acceleration*dt;value+=velocity*dt;remaining-=dt;
  }
  if(Math.abs(value-target)<0.015&&Math.abs(velocity)<0.02)return {value:target,velocity:0};
  return {value,velocity};
}

export function enhance21stControls(root=document,{magnification=80,distance=150}={}) {
  const cleanups=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const coarse=matchMedia('(hover: none), (pointer: coarse)');
  const bind=(node,type,listener,options)=>{node.addEventListener(type,listener,options);cleanups.push(()=>node.removeEventListener(type,listener,options));};

  root.querySelectorAll('.pane-tabs').forEach(tabs=>{
    if(tabs.dataset.twentyoneEnhanced)return;
    tabs.dataset.twentyoneEnhanced='true';tabs.classList.add('twentyone-tabs');
    const buttons=[...tabs.querySelectorAll('[data-pane]')];
    buttons.forEach(button=>{
      const label=button.querySelector(':scope > span');if(!label)return;
      const text=label.textContent.trim();button.setAttribute('aria-label',text);button.title=text;
      label.classList.add('twentyone-tab-label');
    });
    const sync=()=>{buttons.forEach(button=>{
      const selected=button.getAttribute('aria-selected')==='true';
      button.classList.toggle('is-expanded',selected);
      const label=button.querySelector('.twentyone-tab-label');
      if(label)button.style.setProperty('--tab-label-width',`${Math.max(32,label.scrollWidth)}px`);
    });};
    const observer=new MutationObserver(sync);
    buttons.forEach(button=>observer.observe(button,{attributes:true,attributeFilter:['aria-selected']}));
    cleanups.push(()=>observer.disconnect());
    bind(tabs,'click',()=>{tabs.classList.remove('labels-collapsed');queueMicrotask(sync);});
    bind(tabs,'focusin',()=>tabs.classList.remove('labels-collapsed'));
    bind(document,'pointerdown',event=>{if(!tabs.contains(event.target))tabs.classList.add('labels-collapsed');});
    // Resize and font loading can change localized label widths.
    bind(window,'resize',sync);document.fonts?.ready.then(sync);sync();
  });

  root.querySelectorAll('.map-tools').forEach(dock=>{
    if(dock.dataset.twentyoneEnhanced)return;
    dock.dataset.twentyoneEnhanced='true';dock.classList.add('twentyone-dock');
    dock.setAttribute('role','toolbar');
    const items=[...dock.querySelectorAll('button')].map((button,index)=>{
      button.classList.add('twentyone-dock-item');
      const title=button.getAttribute('aria-label')||button.title||button.textContent.trim();
      button.removeAttribute('title');
      const icon=document.createElement('span');icon.className='twentyone-dock-icon';icon.setAttribute('aria-hidden','true');
      while(button.firstChild)icon.append(button.firstChild);button.append(icon);
      const label=document.createElement('span');label.className='twentyone-dock-label';
      label.textContent=title;label.id=`twentyone-dock-label-${button.id||index}`;label.setAttribute('role','tooltip');button.append(label);
      button.setAttribute('aria-describedby',label.id);
      return {button,value:40,velocity:0,target:40};
    });
    let pointer=Infinity,focused=null,raf=0,last=0;
    const compact=()=>matchMedia('(max-width: 700px)').matches;
    const maxSize=()=>compact()?Math.min(magnification,64):magnification;
    const measure=()=>{
      const enabled=!reduced.matches&&!coarse.matches&&!matchMedia('(max-height: 500px)').matches;
      items.forEach(item=>{
        const rect=item.button.getBoundingClientRect();
        const delta=focused===item.button&&item.button.matches(':focus-visible')?0:pointer-rect.left-rect.width/2;
        item.target=enabled?dockTarget(delta,{distance,base:40,magnification:maxSize()}):40;
      });
      if(!raf){last=performance.now();raf=requestAnimationFrame(tick);}
    };
    const paint=item=>{
      item.button.style.setProperty('--dock-size',`${item.value.toFixed(3)}px`);
      // Original DockIcon uses width / 2. Existing glyphs inherit equivalent size.
      item.button.style.setProperty('--dock-icon-size',`${(item.value/2).toFixed(3)}px`);
    };
    const tick=now=>{
      const dt=(now-last)/1000;last=now;let moving=false;
      items.forEach(item=>{
        const next=reduced.matches?{value:item.target,velocity:0}:advanceSpring(item.value,item.velocity,item.target,dt);
        item.value=next.value;item.velocity=next.velocity;paint(item);
        if(item.value!==item.target||item.velocity!==0)moving=true;
      });
      raf=moving?requestAnimationFrame(tick):0;
    };
    bind(dock,'pointermove',event=>{if(event.pointerType==='touch')return;pointer=event.clientX;focused=null;measure();});
    bind(dock,'pointerleave',()=>{pointer=Infinity;measure();});
    items.forEach(item=>{
      const show=()=>item.button.classList.add('tooltip-visible');
      const hide=()=>item.button.classList.remove('tooltip-visible');
      bind(item.button,'pointerenter',show);bind(item.button,'pointerleave',hide);
      bind(item.button,'focus',()=>{focused=item.button;if(item.button.matches(':focus-visible'))show();measure();});
      bind(item.button,'blur',()=>{focused=null;hide();measure();});
      bind(item.button,'keydown',event=>{if(event.key==='Escape')hide();});
      paint(item);
    });
    bind(reduced,'change',measure);bind(coarse,'change',measure);bind(window,'resize',()=>{pointer=Infinity;measure();});
    // Touch navigation remains stable at 40 px and needs no hover to activate.
    cleanups.push(()=>{if(raf)cancelAnimationFrame(raf);});
  });
  return ()=>cleanups.reverse().forEach(fn=>fn());
}
