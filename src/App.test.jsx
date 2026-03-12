import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

// Mock Recharts ResponsiveContainer to fix jsdom height/width rendering warnings
vi.mock('recharts', async () => {
    const OriginalRecharts = await vi.importActual('recharts');
    return {
        ...OriginalRecharts,
        ResponsiveContainer: ({ children }) => (
            <div style={{ width: '800px', height: '600px' }}>{children}</div>
        )
    };
});

// Mock PapaParse directly to bypass raw text async parsing latency in JsDOM
const mockParsedData = [];
for (let r = 0; r <= 60; r++) {
    mockParsedData.push({
        Machine_ID: 'M01',
        Run_Num: r,
        process_start_time: `2026-03-01T00:00:${r < 10 ? '0' + r : r}Z`,
        knob_Time: 1.0,
        FFW: 10.0,
        'FFW-Target': 0.0,
        Model_A: 1.0,
        FBW_Target: 0.0,
        Real_A: 1.0,
        Actual_Removal: +(1.0 + (r % 2 === 0 ? 0.05 : -0.05)).toFixed(3),
        'FFW-FBW': +(0.1 + (r % 3 === 0 ? 0.05 : -0.05)).toFixed(3)
    });
}

vi.mock('papaparse', () => ({
    default: {
        parse: (csvText, config) => {
            if (config && config.complete) {
                config.complete({ data: mockParsedData });
            }
        }
    }
}));

describe('R2R Sandbox App', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                text: () => Promise.resolve("mocked_text_ignored_by_papaparse")
            })
        );
    });

    describe('Rendering', () => {
        it('should render main application headers without crashing', async () => {
            render(<App />);
            expect(screen.getByText(/R2R Simulator Sandbox/i)).toBeInTheDocument();
            expect(screen.getByText(/Machine Selector/i)).toBeInTheDocument();
            expect(screen.getByText(/Parameters/i)).toBeInTheDocument();

            // Await data load
            await waitFor(() => {
                expect(screen.getByText('Active:')).toBeInTheDocument();
            });
        });
    });

    describe('User Interactions', () => {
        it('should update SNR Multiplier text when slider changes', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('M01'));

            const sliders = screen.getAllByRole('slider');
            // Slider 1: SNR Multiplier
            fireEvent.change(sliders[0], { target: { value: '2.5' } });
            expect(screen.getByText('2.5x')).toBeInTheDocument();
        });

        it('should update Lambda text when slider changes', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('M01'));

            const sliders = screen.getAllByRole('slider');
            // Slider 2: Lambda
            fireEvent.change(sliders[1], { target: { value: '0.8' } });
            expect(screen.getByText('0.8')).toBeInTheDocument();
        });

        it('should update Sampling Rate percentage text when slider changes', async () => {
            render(<App />);
            await waitFor(() => screen.getByText('M01'));

            const sliders = screen.getAllByRole('slider');
            // Slider 3: Sampling Rate
            fireEvent.change(sliders[2], { target: { value: '0.4' } });
            expect(screen.getByText('40%')).toBeInTheDocument();
        });
    });

    describe('Edge Cases', () => {
        it('should gracefully handle fetch errors', async () => {
            global.fetch = vi.fn(() => Promise.reject('Network Error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            render(<App />);
            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalled();
            });
            consoleSpy.mockRestore();
        });
    });
});
