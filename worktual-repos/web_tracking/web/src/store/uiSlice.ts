import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type Period = 'today' | 'week' | 'month' | 'overall';

interface UiState {
  period: Period;
}

const initialState: UiState = { period: 'overall' };

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setPeriod(state, action: PayloadAction<Period>) {
      state.period = action.payload;
    },
  },
});

export const { setPeriod } = uiSlice.actions;
export default uiSlice.reducer;
