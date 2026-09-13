# Wattson presentation playbook

## Objective

Present Wattson as a tested proof of concept for the HackOut'26 problem statement:

> Microgrid Energy Mix Optimizer for Off-Grid Communities

The presentation must show that Wattson covers the complete operating problem. It combines renewable forecasts, storage, diesel backup, fuel limits, service demand, and reliability commitments.

## Core message

Wattson gives a microgrid operator a verified 24-hour operating plan before a difficult day begins.

The product does more than show energy totals. It connects each dispatch decision to a community promise, such as continuous power for a health center or water delivery before evening.

## Main scenario

Use the Spiti Valley Community Grid throughout the slides and demonstration.

The simulated day contains three disruptions:

- Dense clouds reduce solar availability to 35% from 10:30 AM to 3:30 PM.
- Household demand rises by 15% from 5:30 PM to 8:30 PM.
- A diesel delivery scheduled for 6:00 PM arrives at 10:00 PM.

The site contains:

- 220 kW of solar and 60 kW of wind.
- A 900 kWh battery with a 180 kWh operating reserve.
- A 160 kW diesel generator.
- Eight community services and seven commitments.

The current simulation result protects all seven commitments with zero unserved energy. HiGHS found an optimal plan in approximately four seconds during the presentation check.

These results come from a simulated scenario. Do not describe them as field results.

## Timing

Target 8 minutes 30 seconds of prepared content. Keep 1 minute 30 seconds for transitions, delays, or judge questions.

| Part | Time | Presenter |
| --- | ---: | --- |
| Slides 1 to 4 | 2:45 | Mahek |
| Slides 5 and 6 | 1:45 | Vinesh |
| Slide 7 and demo transition | 0:45 | Mahek |
| Live demonstration | 2:45 | Vinesh |
| Buffer | 1:30 | Both |

## Slide plan

### Slide 1: A difficult day in Spiti Valley

**Purpose:** Make the reliability problem concrete within 30 seconds.

**On-slide content:**

> Solar falls to 35%. Demand rises. The fuel truck is four hours late.

Show one photograph of a remote mountain community and a compact timeline of the three disruptions.

**Mahek says:**

> Imagine operating an isolated community grid in Spiti Valley. At 10:30, dense clouds cut solar output. Household demand rises after sunset, but the next diesel delivery is four hours late. The operator must decide which resources to use now, while protecting health care, water, communications, and food storage for the full day.

Do not begin with the technology stack or team introduction.

### Slide 2: The operator has a planning problem

**Purpose:** Connect the scenario to the official problem statement.

**On-slide content:**

- Renewable output changes with weather.
- Batteries have power, energy, and reserve limits.
- Diesel adds cost, emissions, startup constraints, and fuel risk.
- Community services have different priorities and deadlines.

Use one energy-flow illustration. Avoid a dense list of general renewable-energy statistics.

**Mahek says:**

> A normal dashboard shows generation and demand. It does not tell the operator whether using the battery now will endanger the health center tonight. This is a planning problem across time, physical limits, fuel availability, and service priorities.

### Slide 3: Wattson creates the operating plan

**Purpose:** Explain the product in one sentence and one workflow.

**On-slide content:**

> A service-first energy mix optimizer for community microgrids

Use this four-stage workflow:

1. Model the site and service commitments.
2. Add renewable forecasts and disruption scenarios.
3. Calculate a 96-interval dispatch plan.
4. Replay decisions and inspect outcomes.

**Mahek says:**

> Wattson turns the microgrid into an operating model. The operator defines assets and community promises, adds expected disruptions, and calculates a complete 24-hour response. Wattson then explains when it uses renewable power, storage, or diesel and whether each promise remains safe.

### Slide 4: Coverage of the challenge

**Purpose:** Make complete problem-statement coverage obvious.

| Challenge requirement | Wattson implementation |
| --- | --- |
| Solar and wind | Availability curves and outage events |
| Battery storage | State of charge, reserve, efficiency, and power limits |
| Diesel backup | Fuel inventory, deliveries, cost, startup, runtime, and ramp limits |
| Weather | Live Open-Meteo forecast with operating recommendations |
| Reliable uptime | Critical, essential, and flexible service commitments |
| Cost and emissions | Fuel-cost optimization with measured cost and emissions |
| Operator interface | React workspace, scenario controls, replay, and comparisons |

**Mahek says:**

> The problem statement asks for the complete energy mix, not an isolated prediction model. Wattson represents each resource, applies weather and fuel constraints, protects service commitments, and gives the operator one interface for planning and review.

### Slide 5: Two-layer planning and validation

**Purpose:** Prove technical depth without teaching optimization theory.

Show a clean architecture flow:

> React operator workspace
>
> Go API and domain model
>
> Pyomo and HiGHS produce a 96-interval dispatch plan
>
> pandapower validates AC power flow in every interval
>
> Go approves the result or reports an electrical violation

Add Open-Meteo beside the Go API as an external forecast source.

**Vinesh says:**

> We separate operating decisions from electrical validation. First, Go applies the disruptions and sends normalized 15-minute inputs to our Pyomo model. HiGHS chooses when to charge the battery, run diesel, and move flexible demand. The model gives much larger penalties to missed critical commitments. Then pandapower calculates AC power flow for the proposed schedule. It checks voltage, line loading, network losses, and disconnected sections. Go accepts the plan only after the required checks pass. If the optimizer cannot return a usable result, a deterministic fallback remains available.

Use these labels on the slide:

- Layer 1: Operational feasibility
- Layer 2: Electrical feasibility

This distinction is easier to explain than listing every library in one technology stack.

If a judge asks about “AI,” describe Wattson as mathematical optimization and decision intelligence. Do not label the mixed-integer model as machine learning.

### Slide 6: Spiti Valley stress-test result

**Purpose:** Show one memorable proof point.

Use three large figures:

- 7 of 7 commitments protected
- 0 kWh unserved energy
- Optimal plan in about 4 seconds

Below the figures, name the three disruptions. Add a small “simulated proof of concept” label.

**Vinesh says:**

> We stress-tested one operating day with a five-hour solar shortfall, an evening demand surge, and a four-hour fuel delay. Wattson calculated an optimal response in about four seconds. The plan protected all seven commitments and produced zero unserved energy. The result includes the battery trajectory, diesel use, cost, emissions, and every explained operator decision. Our electrical validation layer then checks whether the proposed schedule can operate on the modeled network.

### Slide 7: From proof of concept to deployment

**Purpose:** Establish feasibility and end with the user benefit.

**On-slide content:**

**Users**

Microgrid operators, rural electrification agencies, and NGOs.

**Deployment path**

Connect site telemetry and forecast adapters, calibrate the asset model, and operate with human approval.

**Closing line**

> Wattson helps operators protect community services before renewable uncertainty becomes an outage.

**Mahek says:**

> Wattson is a tested proof of concept. The next deployment step is to connect real site telemetry, calibrate the model with operator data, and keep the operator in control of every plan. We built Wattson so that renewable uncertainty becomes a decision the operator can prepare for, instead of an outage the community must absorb. Let us show you the operating day.

## Live demonstration

### Preparation

Use the Spiti Valley seeded site. Use the light or dark theme with the clearest projector contrast.

Open two browser tabs before the presentation:

1. The Spiti Valley forecast page.
2. The Spiti Valley operations page.

Use the operations page as the active tab. Keep the browser at a zoom level that shows the scenario control and plan brief after one short scroll.

Run a complete rehearsal with the same database and network. Make sure that the operations page selects the correct scenario.

If pandapower is complete, prepare one successful validation result that covers all 96 intervals. The ideal interface summary is “96 of 96 intervals electrically feasible.”

Keep a completed plan available before the presentation. The live calculation can create a fresh plan, but the saved result protects the demonstration from an unexpected delay.

### Demonstration script

#### 0:00 to 0:25: Site model

Show the operations canvas.

> This is the Spiti Valley microgrid. Wattson models solar, wind, the battery, diesel backup, and every connected community service. The connections are part of the operating model, not decoration.

Point to the health center, drinking water, and battery. Do not edit grid resources during the demonstration.

#### 0:25 to 0:50: Live forecast

Switch to the prepared forecast tab.

> Wattson uses Open-Meteo to retrieve live weather for the site. It translates solar radiation, cloud cover, wind, and gusts into operating recommendations. The prototype keeps the operator responsible for applying those recommendations to the next planning scenario.

Return to the operations tab.

#### 0:50 to 1:15: Disruptions and commitments

Point to the three configured disruptions.

> For this stress test, solar falls to 35%, household demand rises by 15%, and the diesel delivery arrives four hours late. Below the energy model, Wattson stores explicit commitments for health care, communications, water, lighting, and other services.

Do not open an edit dialog unless a judge asks.

#### 1:15 to 1:35: Calculate

Select **Replan** on the canvas.

> Go now applies the disruptions and sends the complete 96-interval model to the Python optimizer. HiGHS calculates the schedule. Pandapower then checks the electrical network before Go approves the result.

Allow silence while the calculation completes. Do not fill four seconds with architecture details.

#### 1:35 to 2:15: Replay and explanation

Let the replay start.

> The animation shows the planned flow across the day. The plan brief reports seven of seven commitments protected and zero unserved energy. The decision feed explains important actions, including when Wattson starts the generator.

Select one decision to move the replay to that interval.

#### 2:15 to 2:45: Electrical evidence and conclusion

Show the electrical-validation result, then scroll to the key signals or commitment outcomes.

> The proposed dispatch also passes the network check for voltage and line loading. The operator can inspect demand served, battery reserve, commitment progress, diesel cost, and emissions. Wattson keeps a normal-day baseline, so the operator can see the extra operating cost caused by the disruption.

End with:

> Wattson converts uncertain renewable supply into a verified operating plan tied to real community services.

Stop at this point. Do not continue exploring the interface.

## Demonstration backup

Prepare a local screen recording of the exact 2-minute-45-second flow. Keep it open in a separate window.

Also prepare four screenshots:

1. Spiti Valley grid architecture.
2. Three active disruptions.
3. Seven of seven commitments protected.
4. Key signals and comparison results.

If the live calculation fails, say:

> We also saved the verified result from this exact scenario. I will continue with that result.

Do not discuss the technical failure during the timed presentation.

## YouTube video plan

Target a final duration from 8 minutes to 9 minutes. Record at 1080p. Use clear narration and captions.

### 0:00 to 0:40: Opening scenario

Use the Slide 1 scenario and explain the operator's decision problem.

### 0:40 to 1:30: Problem statement and users

Show the official problem statement briefly. Identify microgrid operators, rural electrification agencies, and NGOs as the main users.

### 1:30 to 2:20: Product overview

Explain the four-stage Wattson workflow. Show the site portfolio and Spiti Valley overview.

### 2:20 to 3:35: Technical architecture

Use the architecture slide. Vinesh explains the Go boundary, Pyomo model, HiGHS solver, pandapower validation, persistence, and fallback.

### 3:35 to 6:35: Product demonstration

Use a clean screen recording. Show the live forecast, grid topology, disruption scenario, calculation, electrical validation, replay, commitments, and comparison.

Speed up only dead time. Do not speed up pointer movement or spoken explanations.

### 6:35 to 7:30: Results

Show the three proof figures from Slide 6. State that they come from a simulated scenario.

### 7:30 to 8:20: Feasibility and roadmap

Explain that the proof of concept uses seeded site data. The next version can connect smart meters, battery-management systems, fuel sensors, and operator-approved forecast updates.

### 8:20 to 8:45: Team and closing

Show both team members and their responsibilities:

- Vinesh: backend, domain model, optimization integration, and system architecture.
- Mahek: frontend, operator experience, presentation, and product pitch.

Close with the same line as the live presentation.

## Judge questions

### Is this machine learning?

> Wattson uses mathematical optimization, not a trained prediction model. Forecast providers estimate renewable conditions. Our mixed-integer model calculates the best feasible operating schedule under those conditions.

### What does the optimizer minimize?

> It first uses high penalties to prevent service shortfalls. Among feasible plans, it minimizes diesel fuel cost, renewable curtailment, battery throughput, and dumped power.

### How do you know the plan is physically valid?

> We use two validation levels. Go verifies energy balance, battery state, generator limits, and the solver response. Pandapower then calculates AC power flow to check bus voltage, reactive power, network losses, and line or transformer loading.

### Why not put AC power flow directly inside the optimizer?

> The mixed-integer model handles decisions across 96 time intervals quickly. Full AC power flow is nonlinear. Separating scheduling from network validation keeps the first solve fast while rejecting schedules that violate electrical limits.

### What happens when pandapower finds a violation?

> Wattson identifies the affected interval, bus, or line. The current proof of concept reports the violation for operator review. The next step feeds derived limits back into the scheduler for automatic recalculation.

### What happens if the optimizer fails?

> Wattson has a deterministic fallback planner. The interface identifies when it uses the fallback, so the operator can see how the plan was produced.

### Is the weather forecast connected to the optimizer?

> Open-Meteo supplies live weather and operating recommendations. In this proof of concept, the operator applies those recommendations to the renewable forecast curves before recalculation. Automatic synchronization is a deployment step.

### Are these real community results?

> No. These are realistic seeded scenarios for a tested proof of concept. A field deployment needs site telemetry, calibrated equipment data, and validation with local operators.

### How does Wattson reduce emissions?

> Wattson uses renewable power before diesel where the constraints permit it. It measures emissions from fuel use and exposes the trade-off to the operator. The current optimizer minimizes fuel cost directly. An explicit emissions weight is a planned extension.

### Why use Go and Python together?

> Python provides the optimization ecosystem through Pyomo and HiGHS. Go owns the API, validation, persistence, concurrency boundaries, and independent verification. The narrow JSON contract keeps the solver replaceable.

### Can this work in real time?

> The current model recalculates a 24-hour plan in a few seconds. It supports rapid replanning when forecasts, fuel, demand, or asset availability change. It is not a closed-loop hardware controller.

### How does this scale?

> Each site has an independent scenario and plan history. Larger sites increase the mixed-integer model size. Deployment can calculate plans asynchronously and use rolling horizons with shorter intervals where required.

## Accuracy rules

Use these claims:

- “Tested proof of concept.”
- “Simulated community operating scenario.”
- “Live Open-Meteo forecast and operating recommendations.”
- “Rapid replanning in a few seconds.”
- “Least-cost feasible plan under service-priority constraints.”
- “Measured diesel cost and emissions.”
- “Two-layer operational and electrical validation.”

Do not use these claims:

- “Deployed in Spiti Valley.”
- “Proven to reduce community energy costs.”
- “Real-time autonomous grid control.”
- “AI predicts demand.”
- “Live weather automatically controls the optimizer.”
- “The optimizer directly minimizes emissions.”
- “Pandapower guarantees safety for a real site.”

## High-priority product gap

The official problem statement asks the optimizer to minimize both cost and emissions. The current objective minimizes fuel cost but does not contain a separate emissions term.

Before the final presentation, add a configurable emissions weight to the optimizer objective. Then expose that weight or selected operating mode in the interface. This change makes the implementation match the problem statement and gives judges a clear cost-versus-emissions trade-off.

The live forecast currently produces recommendations instead of automatically changing the scenario forecast. This behavior is acceptable for an operator-approved proof of concept, but the presentation must describe it accurately.

Pandapower becomes a presentation claim only after its integration passes a complete scenario test. Until then, describe it as the validation layer under development. A library name alone is not proof. The demo needs a visible result, such as interval coverage, minimum voltage, maximum line loading, or a specific violation.
