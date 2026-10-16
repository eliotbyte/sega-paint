# Dusk Run: 16 bars (~30 s) in E minor with a home-made pluck bass.
song "Dusk Run"  bpm 128  4/4  grid 16
base skitchin
key E minor

sound bass  = "pluck-bass.spp"
sound lead  = "Skitchin':f1"
sound chord = "Skitchin':s168b9e"
sound kick  = "Skitchin':s16c225"
sound snare = "Skitchin':s16cadc"
sound hat   = "Skitchin':d42"
sound ohat  = "Skitchin':d46"
sound crash = "Skitchin':d49"
sound sq    = "Skitchin':p0"

track FM1 "Pluck bass"
track FM2 "Kit"
track FM3 "Lead"

pattern beat 1:
  DAC1 kick : x... ..x. x... ....
  DAC1 snare: .... x... .... x...
  FM2  hat  : x.x. x.x. x.x. x.x.

pattern intro 2:
  FM1  bass : E2/2 -/2 E2/2 E3/2 E2/2 -/2 D2/2 E2/2 | C2/2 -/2 C2/2 C3/2 D2/2 -/2 D2/2 D3/2
  DAC4 chord: E3/8 -/8 | C3/8 D3/8
  FM2  hat  : x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.xx

pattern groove 2:
  FM1  bass : E2/2 -/2 E2/2 E3/2 E2/2 -/2 D2/2 E2/2 | C2/2 -/2 C2/2 C3/2 D2/2 -/2 D2/2 D3/2
  DAC4 chord: E3/4 -/4 E3/4 -/4 | C3/4 -/4 D3/4 -/4
  DAC1 kick : x... ..x. x... .... | x... ..x. x... ..x.
  DAC1 snare: .... x... .... x... | .... x... .... x..x
  FM2  hat  : x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.

pattern tune 2:
  FM3  lead : B4/4 G4/2 A4/2 B4/4 E5/4 | E5/6 D5/2 B4/4 A4/4
  FM3  vol 12
  FM1  bass : E2/2 -/2 E2/2 E3/2 E2/2 -/2 D2/2 E2/2 | C2/2 -/2 C2/2 C3/2 D2/2 -/2 D2/2 D3/2
  DAC4 chord: E3/8 -/8 | C3/8 D3/8
  DAC1 kick : x... ..x. x... .... | x... ..x. x... ....
  DAC1 snare: .... x... .... x... | .... x... .... x.xx
  FM2  crash: x... .... .... .... | .... .... .... ....
  FM2  ohat : ..x. ..x. ..x. ..x. | ..x. ..x. ..x. ..x.

pattern tune2 2:
  FM3  lead : B4/4 G4/2 A4/2 B4/4 D5/4 | E5/4 G5/4 A5/4 F#5/4
  FM3  vol 12
  PSG1 sq   : E5 G5 B5 E6 E5 G5 B5 E6 E5 G5 B5 E6 E5 G5 B5 E6 | C5 E5 G5 C6 C5 E5 G5 C6 D5 F#5 A5 D6 D5 F#5 A5 D6
  FM1  bass : E2/2 -/2 E2/2 E3/2 E2/2 -/2 D2/2 E2/2 | C2/2 -/2 C2/2 C3/2 D2/2 -/2 D2/2 D3/2
  DAC4 chord: E3/8 -/8 | C3/8 D3/8
  DAC1 kick : x... ..x. x... .... | x... ..x. x... ....
  DAC1 snare: .... x... .... x... | .... x... .... xxxx
  FM2  ohat : ..x. ..x. ..x. ..x. | ..x. ..x. ..x. ..x.

section verse  = groove x3
section chorus = tune, tune2, tune, tune2
arrange: intro verse chorus
loop: verse
