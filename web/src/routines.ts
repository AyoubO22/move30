export interface Step { name: string; secs: number; cue: string }
export interface Routine { id: "desk-reset" | "walk-5" | "stair-burst" | "post-meal" | "stretch"; name: string; minutes: number; tag: string; desc: string; steps: Step[] }

export const ROUTINES: Routine[] = [
  {
    id: "desk-reset", name: "Desk reset", minutes: 3, tag: "Legs",
    desc: "Half-squats, calf raises, glute squeezes and knee raises, right next to your desk.",
    steps: [
      { name: "Half-squats", secs: 45, cue: "Feet hip-width, sit back halfway, stand tall." },
      { name: "Calf raises", secs: 45, cue: "Rise onto your toes, lower slowly." },
      { name: "Glute squeezes", secs: 45, cue: "Stand tall, squeeze for 2 seconds, release." },
      { name: "Knee raises", secs: 45, cue: "March in place, knees to hip height." },
    ],
  },
  {
    id: "walk-5", name: "Five-minute walk", minutes: 5, tag: "Walk",
    desc: "The dose that lowered both blood sugar and blood pressure in the Columbia study.",
    steps: [
      { name: "Walk", secs: 150, cue: "Easy pace. Hallway, stairs, or to the coffee machine and back." },
      { name: "Keep walking", secs: 150, cue: "Halfway there. Relax your shoulders." },
    ],
  },
  {
    id: "stair-burst", name: "Stair burst", minutes: 1, tag: "Vigorous",
    desc: "One minute that gets you slightly out of breath.",
    steps: [{ name: "Climb the stairs briskly", secs: 60, cue: "Or a fast power-walk down the corridor." }],
  },
  {
    id: "stretch", name: "Desk stretch", minutes: 2, tag: "Mobility",
    desc: "Undo the screen hunch: chest, neck and hips.",
    steps: [
      { name: "Chest opener", secs: 30, cue: "Hands behind your back, lift your chest." },
      { name: "Neck tilt", secs: 30, cue: "Ear toward shoulder, both sides." },
      { name: "Hip flexor stretch", secs: 30, cue: "Lunge stance, tuck the pelvis, switch halfway." },
      { name: "Reach up", secs: 30, cue: "Arms overhead, reach long, breathe." },
    ],
  },
  {
    id: "post-meal", name: "Post-lunch walk", minutes: 15, tag: "After eating",
    desc: "Start about 30 minutes after lunch, when blood sugar usually peaks.",
    steps: [
      { name: "Walk", secs: 300, cue: "Moderate pace, you can still talk." },
      { name: "Keep going", secs: 300, cue: "Take the long way around the building." },
      { name: "Last stretch", secs: 300, cue: "Almost done. Nice work." },
    ],
  },
];
