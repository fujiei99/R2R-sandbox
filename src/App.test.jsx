import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

describe('R2R Sandbox App', () => {
    it('renders without crashing', () => {
        // The App component attempts to fetch a CSV file on mount.
        // Given the fetch inside loadData() won't fully resolve a valid CSV in jsdom without mocking,
        // we primarily test that the initial loading UI or basic frame renders successfully.
        const { container } = render(<App />);
        expect(container).toBeTruthy();

        // Ensure the loading state or the parameter headers appear
        const textNode = container.textContent;
        expect(textNode).toMatch(/Loading engine|Parameters|Playback Results/i);
    });
});
