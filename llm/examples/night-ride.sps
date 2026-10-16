# The sketch of docs/llm-tools.md, made to build.
song "Night Ride"  bpm 140  4/4  grid 16     # grid: steps per bar
base skitchin
key A minor

sound bass = "Skitchin':f0"
sound gtr  = "Skitchin':s168b9e"
sound kick = "Skitchin':s16c225"
sound snare = "Skitchin':s16cadc"
sound hat  = "Skitchin':d42"
sound sq   = "Skitchin':p0"

pattern groove 1:
  FM1  bass : A2/2 -/2 A2/2 C3/2 | E3/4 D3/4
  FM1  vol 12 at 5
  DAC4 gtr  : A3/4 -/4 A3/4 G3/4
  DAC1 kick : x... ..x. x.x. ....
  DAC1 snare: ....x... ....x...
  FM2  hat  : x.x. x.x. x.x. x.x.

pattern lead 2:
  PSG1 sq : A4/4 C5/4 E5/4 D5/4 | C5/8 B4/8
  FM1  bass : A2/16 | F2/16

section verse  = groove x3, groove +5
section chorus = lead, groove x2
arrange: verse chorus verse chorus
loop: chorus
