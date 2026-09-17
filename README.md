# Driving Sim · Jev Autopilot

A 3D driving simulator built with Three.js, driven autonomously by [TypeSafe](https://typesafe.ai)'s **Jev** model
through the AI SDK's `@ai-sdk/typesafe-ai` provider.

The mission: drive from **A** to **B** through a randomly generated city grid. Stay in your lane,
choose the right turn at each intersection, stop for red lights, and stop at the destination.

## Run it

```bash
npm install
echo "TYPESAFE_AI_API_KEY=your-key" > .env
npm run dev
```

Open http://localhost:5173 and press **J** to hand the wheel to Jev.

## Controls

| Key | Action |
| --- | --- |
| `J` | Toggle Jev autopilot |
| `R` | Reset trip |
| `W` | Gas |
| `S` | Brake |
| `A` / `D` | Steer |

A gamepad works too. Touching any control while Jev is driving gives you the wheel back.
Every refresh generates a new city, with some streets removed so the grid is not fully connected.
The HUD shows the map seed, and `/?seed=<n>` replays one.

## How it works

Jev is not an LLM that writes text. It answers typed questions with calibrated probabilities, in about 200 ms.
So the split is simple:

- **Code does the math.** Lane offset, heading error, where the lane center is 10 m and 22 m ahead,
  distance to the stop line, the traffic light state, which exits the next intersection has, where B is
  in blocks, and the speed that is appropriate for this spot. It turns those numbers into a short
  plain-language situation report ([server/pilot.ts](server/pilot.ts)).
- **Jev makes the calls.** One request asks: which way to steer (*Choice*), gas or brake and how much
  (*Choice*), which exit to take at the upcoming intersection (*Choice*, only when there is a decision to make),
  and whether the trip is complete (*Boolean*).
- **Code turns answers into driving.** Each answer's probability distribution becomes a wheel angle or a
  pedal position ([src/autopilot.ts](src/autopilot.ts)). Code also keeps the lane geometry for the chosen
  turn, tracks which street the car is on, and counts red lights run.

After arriving, the banner shows total tokens and decisions Jev used for the trip.

## Headless test drive

Run the same physics and the same Jev decisions without a browser:

```bash
npm run headless -- 42
```

Prints a telemetry line every few seconds plus every turn Jev plans, and a final result line.
