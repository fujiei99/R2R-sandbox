# R2R Simulation Sandbox

An interactive UI playground for visualizing Run-to-Run (R2R) control simulations. This tool allows users to explore the impact of sampling rates, Signal-to-Noise (S/N) ratios, and EWMA filter weights (λ) on R2R control results in real-time.

🚀 **[Launch Live Playground](https://fujiei99.github.io/R2R-sandbox/)**

## Features

- **Interactive Parameters**: Sliders for S/N Ratio, λ (EWMA Weight), and Sampling Rate.
- **Playback SPC Trace**: Real-time rendering of process bias and control limits (UCL/LCL).
- **Raw Noise Comparison**: A dedicated chart to compare the filtered control state against the raw baseline noise (λ=1).
- **KPI Sweep Analysis**: Deep dive into how Mean Bias and Sigma Spread are affected across the entire spectrum of $\lambda$ weights and Sampling Rates.

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Built with **React**, **Vite**, **Tailwind CSS**, and **Recharts**.
