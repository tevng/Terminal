const ui=(name,mode,palette,values)=>({name,mode,palette,tokens:Object.fromEntries(['bg','panel','raised','input','text','muted','border','accent','on-accent','link','error'].map((key,i)=>[key,values[i]]))});
export const uiThemes={
  midnight:ui('午夜 · 默认','dark','silk',['#101318','#151a21','#1c232d','#11161d','#d4dce6','#95a2b3','#34404f','#92e2c4','#11271e','#8cbced','#ffa0aa']),
  graphite:ui('石墨 · 中性灰','dark','graphite',['#191919','#222222','#2e2e2e','#151515','#ededed','#b0b0b0','#505050','#ffc878','#282016','#9dc8ff','#ff9d9d']),
  navy:ui('深海 · 靛蓝','dark','ocean',['#101827','#152137','#21314b','#0d1523','#d9e6fa','#9bb0cc','#385073','#9bbcff','#142343','#8bdcfa','#ffa8b2']),
  forest:ui('松林 · 暗绿','dark','forest',['#111c18','#182720','#24372d','#0d1712','#d8e8dc','#9fb7a6','#3b5746','#a5d9a2','#142d1b','#9cdde1','#ffaaa0']),
  plum:ui('暮紫 · 柔和','dark','nebula',['#1d1826','#282133','#372c45','#18131f','#eee0f5','#bcabc7','#574369','#dfb4ee','#32163b','#b3cafa','#ffaab7']),
  paper:ui('晴纸 · 浅色','light','paper',['#f3f6fb','#ffffff','#e8edf5','#ffffff','#233044','#596a80','#b7c4d5','#176852','#ffffff','#175ead','#ad203e']),
  sand:ui('暖砂 · 米白','light','sepia',['#f5f0e6','#fffbf4','#eae1d0','#fffdf8','#40382d','#74634e','#c7b89e','#72501d','#ffffff','#315a8c','#a52d38']),
  contrast:ui('高对比 · 纯黑','dark','contrast',['#000000','#000000','#191919','#000000','#ffffff','#dedede','#a6a6a6','#ffe600','#000000','#80e8ff','#ffaaaa'])
};
const ansi=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
function scheme(name,bg,fg,colors,cursor=colors[2],mode='dark'){
  const bright=colors.map((color,i)=>i===0?mix(bg,fg,.55):mix(color,mode==='dark'?'#ffffff':'#000000',mode==='dark'?.22:.18));
  return {name,mode,colors:{background:bg,foreground:fg,cursor,cursorAccent:bg,selectionBackground:mix(bg,cursor,.35),selectionForeground:fg,...Object.fromEntries(ansi.map((key,i)=>[key,[...colors,...bright][i]]))}};
}
export const terminalSchemes={
  silk:scheme('薄荷夜色 · 默认','#101318','#d3dbe5',['#252c36','#ed7c85','#8cdbab','#e7c887','#82b4ee','#c6a0ee','#80d4d6','#d3dbe5'],'#8be0c1'),
  graphite:scheme('石墨金 · 黑灰','#191919','#e9e5df',['#303030','#ed8580','#b8ce8f','#edca83','#9dbbe4','#d8a1c4','#91c9c8','#e9e5df'],'#efc785'),
  ocean:scheme('深海蓝 · 冷色','#0c1927','#d0e4ed',['#233746','#ff8d8d','#98d7b4','#f0d18c','#8cbfff','#b8a2ed','#83dbe4','#d0e4ed'],'#82dce6'),
  forest:scheme('松林绿 · 自然','#101e17','#d4e6d3',['#293b2d','#ed9684','#a9dba1','#e4d58c','#9abed5','#cfacce','#94d8bd','#d4e6d3'],'#b4e3a1'),
  nebula:scheme('星云紫 · 柔和','#20192b','#e7ddf2',['#392e48','#f38baf','#b7dba1','#ecd09e','#a7bcf2','#d0a7ed','#97d9da','#e7ddf2'],'#dab3f2'),
  ember:scheme('余烬橙 · 暖色','#241915','#eaded3',['#402d26','#ef8976','#b5ce91','#f1c27e','#a0b6db','#d5a0bd','#91c9bf','#eaded3'],'#f4b16e'),
  ice:scheme('冰川 · 蓝灰','#172128','#d7e6e9',['#2b3b45','#e9959b','#add7bb','#e4cf9b','#a1c6e9','#c7b1d8','#9cdae1','#d7e6e9'],'#b2e1e5'),
  retro:scheme('磷光绿 · 复古','#07120b','#a8e9af',['#163522','#f09a8d','#8fdd90','#d5d68c','#8bbcd4','#c0a3cc','#85cdb4','#c4eac6'],'#aeffa4'),
  paper:scheme('晴纸 · 明亮','#ffffff','#283449',['#344054','#a52742','#256c4a','#805600','#225ea6','#79449a','#176c79','#68778c'],'#235e8e','light'),
  sepia:scheme('暖砂 · 护眼米白','#fbf4e5','#493b2b',['#514333','#a12e2c','#426234','#825714','#285e89','#7b457e','#256764','#85715a'],'#79541d','light'),
  porcelain:scheme('青瓷 · 浅青','#edf6f4','#263c3a',['#324b48','#a33345','#276747','#78600d','#285f91','#79448c','#176b6d','#617b76'],'#176b6d','light'),
  contrast:scheme('高对比 · 鲜明','#000000','#ffffff',['#4c4c4c','#ff8888','#85ff85','#ffff80','#91c8ff','#ff9aff','#80ffff','#ffffff'],'#ffff00')
};
export function resolveAppearance(options,systemLight=false){
  const uiKey=options.uiTheme==='system'?(systemLight?'paper':'midnight'):Object.hasOwn(uiThemes,options.uiTheme)?options.uiTheme:'midnight';
  const theme=uiThemes[uiKey];
  const schemeKey=Object.hasOwn(terminalSchemes,options.terminalScheme)?options.terminalScheme:theme.palette;
  return {uiKey,ui:theme,schemeKey,terminal:terminalSchemes[schemeKey]};
}
