# A 4-part song for Sega Paint: intro, verse, chorus, bridge. Build: node llm/sp.mjs build llm/examples/neon-alley.sps
song "Neon Alley"  bpm 150  4/4  grid 16
base skitchin
key E minor

sound bass  = "Skitchin':f0"
sound lead  = "Skitchin':f1"
sound chug  = "Skitchin':s168001"
sound chord = "Skitchin':s168b9e"
sound pad   = "Skitchin':s169858"
sound kick  = "Skitchin':s16c225"
sound snare = "Skitchin':s16cadc"
sound hat   = "Skitchin':d42"
sound ohat  = "Skitchin':d46"
sound crash = "Skitchin':d49"
sound tom   = "Skitchin':d45"
sound sq    = "Skitchin':p0"

track FM1 "Bass"
track FM2 "Drums"
track FM3 "Lead"
track DAC1 "Kick & snare"

pattern intro 2:
  DAC4 pad  : E3/16 | C3/16
  FM1  bass : E2/2 -/2 E2/2 -/2 E2/2 -/2 E2/4 | C2/2 -/2 C2/2 -/2 C2/2 -/2 D2/4
  FM2  hat  : x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  FM2  vol 9

pattern riff 1:
  FM1  bass : E2/2 E2 E3 -/2 E2/2 G2/2 -/2 A2/2 B2/2
  DAC4 chug : E2/2 -/2 E2/2 -/2 E2/2 G2/2 -/2 A2/2
  DAC1 kick : x... ..x. x... ....
  DAC1 snare: .... x... .... x..x
  FM2  hat  : x.x. x.x. x.x. x.x.

pattern riff2 1:
  FM1  bass : C2/2 C2 C3 -/2 C2/2 D2/2 -/2 D2/2 B1/2
  DAC4 chug : C2/2 -/2 C2/2 -/2 C2/2 D2/2 -/2 D2/2
  DAC1 kick : x... ..x. x... ....
  DAC1 snare: .... x... .... x...
  FM2  hat  : x.x. x.x. x.x. x.x.

pattern hook 2:
  FM3  lead : B4/4 G4/2 A4/2 B4/4 D5/4 | E5/6 D5/2 B4/4 A4/4
  FM3  vol 13
  DAC4 chord: E3/8 C3/8 | G3/8 D3/8
  FM1  bass : E2/2 -/2 E2/2 E3/2 C2/2 -/2 C2/2 C3/2 | G2/2 -/2 G2/2 G3/2 D2/2 -/2 D2/2 D3/2
  DAC1 kick : x... .... x... .... | x... .... x... ....
  DAC1 snare: .... x... .... x... | .... x... .... x...
  FM2  crash: x... .... .... .... | .... .... .... ....
  FM2  ohat : ..x. ..x. ..x. ..x. | ..x. ..x. ..x. ..x.

pattern hook2 2:
  FM3  lead : B4/4 G4/2 A4/2 B4/4 D5/4 | E5/4 F#5/4 G5/4 F#5/4
  FM3  vol 13
  DAC4 chord: E3/8 C3/8 | G3/8 D3/8
  FM1  bass : E2/2 -/2 E2/2 E3/2 C2/2 -/2 C2/2 C3/2 | G2/2 -/2 G2/2 G3/2 D2/2 -/2 D2/2 D3/2
  DAC1 kick : x... .... x... .... | x... .... x... ....
  DAC1 snare: .... x... .... x... | .... x... .... x.xx
  FM2  ohat : ..x. ..x. ..x. ..x. | ..x. ..x. ..x. ..x.

pattern bridge 2:
  PSG1 sq   : E4 G4 B4 E5 E4 G4 B4 E5 C4 E4 G4 C5 C4 E4 G4 C5 | D4 F#4 A4 D5 D4 F#4 A4 D5 B3 D#4 F#4 B4 B3 D#4 F#4 B4
  DAC4 pad  : E4/8 C4/8 | D4/8 B3/8
  FM1  bass : E2/8 C2/8 | D2/8 B1/8
  FM2  tom  : .... .... .... x.x. | .... .... x.x. xxxx
  DAC1 kick : x... .... x... .... | x... .... x... ....

section verse  = riff x3, riff2
section chorus = hook, hook2
arrange: intro verse verse chorus bridge chorus
loop: verse
