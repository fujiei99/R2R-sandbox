import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Scatter } from 'recharts';
import { Settings, RefreshCw, BarChart2, Activity, Play, SlidersHorizontal } from 'lucide-react';

const App = () => {
  const [data, setData] = useState([]);
  const [machines, setMachines] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState('');

  // Interactive Controls State
  const [samplingRate, setSamplingRate] = useState(1.0); // 0.0 to 1.0, step 0.1
  const [lambda, setLambda] = useState(0.3); // 0.0 to 1.0, step 0.1
  const [snrMultiplier, setSnrMultiplier] = useState(1.0); // Maps to slider 0.1 to 3.0

  // UI State
  const [isLoading, setIsLoading] = useState(false);

  // 1. Data Loading Mechanism
  const loadData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('./r2r_simulation_data.csv');
      if (!response.ok) throw new Error("Could not fetch CSV");

      const csvText = await response.text();

      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed = results.data.filter(r => r.Machine_ID);
          setData(parsed);

          const uniqueMachines = [...new Set(parsed.map(item => item.Machine_ID))];
          setMachines(uniqueMachines);
          if (uniqueMachines.length > 0) {
            setSelectedMachine(uniqueMachines[0]);
          }
          setIsLoading(false);
        }
      });
    } catch (e) {
      console.error(e);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 2. Playback Simulation Engine
  const simulationResults = useMemo(() => {
    if (!selectedMachine || data.length === 0) return { trace: [], summary: null };

    const mData = data.filter(d => d.Machine_ID === selectedMachine).sort((a, b) => a.process_start_time?.localeCompare(b.process_start_time));

    // Compute the valid target suffixes strictly based on the slider percentage
    const targetCount = Math.round(samplingRate * 10);
    const validSuffixes = Array.from({ length: targetCount }, (_, i) => i); // e.g. 50% = [0,1,2,3,4]

    let exe_B = 0.0;
    let exe_B_lambda_1 = 0.0;
    let trace = [];

    for (let i = 0; i < mData.length; i++) {
      const row = mData[i];

      const real_X = row.knob_Time;
      const ffw = row.FFW;
      const ffw_target = row['FFW-Target'];
      const model_a = row.Model_A;
      const fbw_target = row.FBW_Target;

      let new_X = (ffw_target - exe_B) / model_a;
      new_X = Math.max(0.1, new_X);

      const real_A = row.Real_A;
      const original_actual = row.Actual_Removal;
      const new_actual = original_actual + real_A * (new_X - real_X);

      // SNR Scaling: Apply the slider multiplier to the noise factor
      const base_noise = row['FFW-FBW'] - original_actual;
      const noise = base_noise * (1 / snrMultiplier);

      const new_measured = new_actual + noise;
      const new_FBW = ffw - new_measured;
      const bias = new_FBW - fbw_target;

      // Sampling block
      const lotid = String(row.LOTID);
      const last_char = lotid.charAt(lotid.length - 1);
      let was_sampled = false;

      if (!isNaN(last_char) && validSuffixes.includes(parseInt(last_char))) {
        was_sampled = true;
        const error = new_measured - (new_X * model_a);
        exe_B = (1 - lambda) * exe_B + lambda * error;
        exe_B_lambda_1 = (1 - 1.0) * exe_B_lambda_1 + 1.0 * error; // Follow noise 100%
      }

      trace.push({
        run: i,
        FBW: new_FBW,
        Bias: bias,
        up_B: exe_B,
        up_B_raw_noise: exe_B_lambda_1,
        Sampled: was_sampled ? 1 : 0,
        noise_val: noise,
        actual_val: original_actual
      });
    }

    // Exclude burn in (50)
    const valid_trace = trace.slice(50);
    const mean = valid_trace.reduce((acc, val) => acc + val.Bias, 0) / valid_trace.length;
    const variance = valid_trace.reduce((acc, val) => acc + Math.pow(val.Bias - mean, 2), 0) / valid_trace.length;
    const sigma = Math.sqrt(variance);

    // Compute SPC limits natively to the trace for Recharts
    const ucl = mean + 3 * sigma;
    const lcl = mean - 3 * sigma;
    trace = trace.map(t => ({ ...t, UCL: ucl, LCL: lcl, Target: 0 }));

    // Find symmetric Y-max
    const maxVal = Math.max(Math.abs(ucl), Math.abs(lcl), ...valid_trace.map(t => Math.abs(t.Bias)));
    const yMax = Math.ceil(maxVal * 1.1);

    // Calculate actual SNR of the generated payload in dB
    const noise_mean = valid_trace.reduce((acc, val) => acc + val.noise_val, 0) / valid_trace.length;
    const noise_var = valid_trace.reduce((acc, val) => acc + Math.pow(val.noise_val - noise_mean, 2), 0) / valid_trace.length;
    const signal_mean = valid_trace.reduce((acc, val) => acc + val.actual_val, 0) / valid_trace.length;
    const signal_var = valid_trace.reduce((acc, val) => acc + Math.pow(val.actual_val - signal_mean, 2), 0) / valid_trace.length;

    let snr_db = 0;
    if (noise_var > 0 && signal_var > 0) {
      snr_db = 10 * Math.log10(signal_var / noise_var);
    }

    return {
      trace: trace, // Keep full trace for viz
      yMax: yMax,
      summary: { mean, sigma, snr: snr_db.toFixed(2), rmse: Math.sqrt(mean * mean + variance).toFixed(3) }
    };

  }, [data, selectedMachine, samplingRate, lambda, snrMultiplier]);


  // 3. Multi-point simulation for Charts across Lambdas (fixing Sampling Rate)
  const lambdaSweepData = useMemo(() => {
    if (!selectedMachine || data.length === 0) return [];
    const mData = data.filter(d => d.Machine_ID === selectedMachine);
    const targetCount = Math.round(samplingRate * 10);
    const validSuffixes = Array.from({ length: targetCount }, (_, i) => i);

    let res = [];
    for (let l = 0; l <= 1.0; l += 0.1) {
      let exe_B = 0.0;
      let errors = [];

      for (let i = 0; i < mData.length; i++) {
        const row = mData[i];
        let new_X = Math.max(0.1, (row['FFW-Target'] - exe_B) / row.Model_A);
        const new_actual = row.Actual_Removal + row.Real_A * (new_X - row.knob_Time);
        const base_noise = row['FFW-FBW'] - row.Actual_Removal;
        const noise = base_noise * (1 / snrMultiplier);
        const new_measured = new_actual + noise;
        const new_FBW = row.FFW - new_measured;

        if (i >= 50) errors.push(new_FBW - row.FBW_Target);

        const lotid = String(row.LOTID);
        const last_char = lotid.charAt(lotid.length - 1);
        if (!isNaN(last_char) && validSuffixes.includes(parseInt(last_char))) {
          exe_B = (1 - l) * exe_B + l * (new_measured - (new_X * row.Model_A));
        }
      }

      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      const sigma = Math.sqrt(errors.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / errors.length);
      res.push({ lambda: parseFloat(l.toFixed(1)), mean, sigma, rmse: Math.sqrt(mean * mean + sigma * sigma) });
    }
    return res;
  }, [data, selectedMachine, samplingRate, snrMultiplier]);


  // 4. Multi-point simulation for Charts across Sampling Rates (fixing Lambda)
  const samplingSweepData = useMemo(() => {
    if (!selectedMachine || data.length === 0) return [];
    const mData = data.filter(d => d.Machine_ID === selectedMachine);

    let res = [];
    for (let sr = 0; sr <= 10; sr += 1) {
      let exe_B = 0.0;
      let errors = [];
      const validSuffixes = Array.from({ length: sr }, (_, i) => i);

      for (let i = 0; i < mData.length; i++) {
        const row = mData[i];
        let new_X = Math.max(0.1, (row['FFW-Target'] - exe_B) / row.Model_A);
        const new_actual = row.Actual_Removal + row.Real_A * (new_X - row.knob_Time);
        const base_noise = row['FFW-FBW'] - row.Actual_Removal;
        const noise = base_noise * (1 / snrMultiplier);
        const new_measured = new_actual + noise;
        const new_FBW = row.FFW - new_measured;

        if (i >= 50) errors.push(new_FBW - row.FBW_Target);

        const lotid = String(row.LOTID);
        const last_char = lotid.charAt(lotid.length - 1);
        if (!isNaN(last_char) && validSuffixes.includes(parseInt(last_char))) {
          exe_B = (1 - lambda) * exe_B + lambda * (new_measured - (new_X * row.Model_A));
        }
      }

      const mean = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
      const sigma = errors.length > 0 ? Math.sqrt(errors.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / errors.length) : 0;
      res.push({ sr: sr * 10, mean, sigma, rmse: Math.sqrt(mean * mean + sigma * sigma) });
    }
    return res;
  }, [data, selectedMachine, lambda, snrMultiplier]);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-amber-200 pb-12">
      {/* Header Area */}
      <header className="px-8 py-5 border-b border-stone-200 bg-white sticky top-0 z-10 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-800 flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-600" />
            R2R Simulator Sandbox <span className="ml-2 text-xs font-medium px-2 py-1 bg-stone-100 rounded-full text-stone-500 border border-stone-200">BETA</span>
          </h1>
          <p className="text-sm text-stone-500 mt-1">Real-time EWMA Playback Analysis Engine</p>
        </div>
        <div className="flex gap-4 items-center">
          {machines.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-stone-600">Active Machine: </label>
              <select
                value={selectedMachine}
                onChange={(e) => setSelectedMachine(e.target.value)}
                className="bg-stone-100 border-none rounded-md px-3 py-1.5 focus:ring-2 focus:ring-amber-500 text-sm font-semibold"
              >
                {machines.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
          <button onClick={loadData} className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors" title="Reload Data">
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="mx-auto max-w-7xl p-8 grid grid-cols-12 gap-8 overflow-hidden">

        {/* Left Column: Controls & Stats */}
        <div className="col-span-12 lg:col-span-3 space-y-6">

          {/* Control Panel */}
          <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
            <div className="flex items-center gap-2 mb-6">
              <SlidersHorizontal className="w-5 h-5 text-amber-600" />
              <h2 className="text-lg font-bold text-stone-800">Parameters</h2>
            </div>

            {/* SNR Slider */}
            <div className="mb-8">
              <div className="flex justify-between items-end mb-2">
                <label className="text-sm font-bold text-stone-700">S/N Ratio Scale</label>
                <span className="text-lg font-black text-amber-600">{snrMultiplier.toFixed(1)}x</span>
              </div>
              <input
                type="range" min="0.1" max="5.0" step="0.1"
                value={snrMultiplier}
                onChange={(e) => setSnrMultiplier(parseFloat(e.target.value))}
                className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              />
              <div className="flex justify-between text-xs text-stone-400 mt-1 font-medium">
                <span>0.1 (High Noise)</span>
                <span>5.0 (Clear)</span>
              </div>
            </div>

            {/* Lambda Slider */}
            <div className="mb-8">
              <div className="flex justify-between items-end mb-2">
                <label className="text-sm font-bold text-stone-700">EWMA FB Weight (λ)</label>
                <span className="text-lg font-black text-amber-600">{lambda.toFixed(1)}</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.1"
                value={lambda}
                onChange={(e) => setLambda(parseFloat(e.target.value))}
                className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              />
              <div className="flex justify-between text-xs text-stone-400 mt-1 font-medium">
                <span>0.0 (Slow)</span>
                <span>1.0 (Fast)</span>
              </div>
            </div>

            {/* Sampling Rate Slider */}
            <div className="mb-2">
              <div className="flex justify-between items-end mb-2">
                <label className="text-sm font-bold text-stone-700">Sampling Rate</label>
                <span className="text-lg font-black text-amber-600">{(samplingRate * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.1"
                value={samplingRate}
                onChange={(e) => setSamplingRate(parseFloat(e.target.value))}
                className="w-full h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              />
              <div className="flex justify-between text-xs text-stone-400 mt-1 font-medium">
                <span>0% (Blind)</span>
                <span>100% (Full)</span>
              </div>
            </div>
          </div>

          {/* Live KPI Summary */}
          <div className="p-6 bg-stone-900 rounded-xl shadow-lg border border-stone-800 text-stone-100 pattern-isometric pattern-stone-800 pattern-bg-transparent pattern-size-4 pattern-opacity-40">
            <h2 className="text-sm font-bold tracking-wider text-stone-400 uppercase mb-4">Playback Results</h2>

            {simulationResults.summary ? (
              <div className="space-y-4 relative z-10">
                <div>
                  <div className="text-stone-400 text-xs font-semibold mb-1">SNR (Signal-to-Noise)</div>
                  <div className="text-2xl font-black text-white">{simulationResults.summary.snr}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-stone-400 text-xs font-semibold mb-1">Mean Bias</div>
                    <div className="text-xl font-black text-emerald-400">{simulationResults.summary.mean.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-stone-400 text-xs font-semibold mb-1">Sigma (StdDev)</div>
                    <div className="text-xl font-black text-rose-400">{simulationResults.summary.sigma.toFixed(2)}</div>
                  </div>
                </div>
                <div className="pt-4 mt-2 border-t border-stone-700">
                  <div className="text-amber-500 text-xs font-bold uppercase mb-1">Overall RMSE Score</div>
                  <div className="text-4xl font-black text-amber-500">{simulationResults.summary.rmse}</div>
                </div>
              </div>
            ) : (
              <div className="text-stone-500 text-sm animate-pulse">Loading engine...</div>
            )}
          </div>
        </div>

        {/* Right Column: Visualizations */}
        <div className="col-span-12 lg:col-span-9 space-y-6">

          {/* Real-time SPC Chart */}
          <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-stone-400" /> Playback SPC Trace
              </h2>
              <span className="text-xs font-medium px-2 py-1 bg-amber-50 text-amber-700 rounded-md">Live Preview</span>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={simulationResults.trace} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                  <XAxis dataKey="run" tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis yAxisId="left" domain={[-simulationResults.yMax, simulationResults.yMax]} orientation="left" tick={{ fontSize: 10, fill: '#78716c' }} tickFormatter={(v) => v.toFixed(1)} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#d97706' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />

                  <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="UCL" stroke="#f43f5e" strokeWidth={1} strokeDasharray="5 5" dot={false} name="UCL (+3σ)" />
                  <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="Target" stroke="#ef4444" strokeWidth={2} dot={false} name="Target (0)" />
                  <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="LCL" stroke="#f43f5e" strokeWidth={1} strokeDasharray="5 5" dot={false} name="LCL (-3σ)" />

                  <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="Bias" stroke="#1c1917" strokeWidth={1} dot={false} name="FBW Bias (Error)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Raw Noise Baseline Chart */}
          <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-stone-400" /> Raw Noise Baseline (λ=1) vs. Controlled
              </h2>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={simulationResults.trace} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                  <XAxis dataKey="run" tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis orientation="left" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#78716c' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />

                  <Line isAnimationActive={false} type="stepAfter" dataKey="up_B" stroke="#d97706" strokeWidth={3} dot={false} name="Current up_B (Filtered)" />
                  <Line isAnimationActive={false} type="stepAfter" dataKey="up_B_raw_noise" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Raw up_B (λ=1)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sweep Analysis Grids */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Lambda Impact Chart - Mean */}
            <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex justify-between">
                <span>Mean Bias vs. Lambda</span>
                <span className="text-stone-400 font-normal">@ {samplingRate * 100}% Sampling</span>
              </h3>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lambdaSweepData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="lambda" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                    <Line isAnimationActive={false} type="monotone" dataKey="mean" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Mean Error" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Lambda Impact Chart - Sigma */}
            <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex justify-between">
                <span>Sigma Spread vs. Lambda</span>
                <span className="text-stone-400 font-normal">@ {samplingRate * 100}% Sampling</span>
              </h3>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={lambdaSweepData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="lambda" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                    <Bar isAnimationActive={false} dataKey="sigma" fill="#f43f5e" name="Sigma (Spread)" radius={[2, 2, 0, 0]} barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sampling Rate Impact Chart - Mean */}
            <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex justify-between">
                <span>Mean Bias vs. Sampling Rate</span>
                <span className="text-stone-400 font-normal">@ λ = {lambda.toFixed(1)}</span>
              </h3>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samplingSweepData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="sr" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                    <Line isAnimationActive={false} type="monotone" dataKey="mean" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Mean Error" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sampling Rate Impact Chart - Sigma */}
            <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
              <h3 className="text-sm font-bold text-stone-800 mb-4 flex justify-between">
                <span>Sigma Spread vs. Sampling Rate</span>
                <span className="text-stone-400 font-normal">@ λ = {lambda.toFixed(1)}</span>
              </h3>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={samplingSweepData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                    <XAxis dataKey="sr" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? value.toFixed(2) : value} />
                    <Bar isAnimationActive={false} dataKey="sigma" fill="#3b82f6" name="Sigma (Spread)" radius={[2, 2, 0, 0]} barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
