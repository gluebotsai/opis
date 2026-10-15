import { useQuery } from '@tanstack/react-query';
import {
  getOverview,
  getTopPages,
  getEngagement,
  getLiveUsers,
  getVisitors,
  getAccount,
} from '../services/api';
import type { Period } from '../store/uiSlice';

export function useOverview(period: Period) {
  return useQuery({
    queryKey: ['overview', period],
    queryFn: async () => (await getOverview(period)).data,
  });
}

export function useTopPages(period: Period) {
  return useQuery({
    queryKey: ['topPages', period],
    queryFn: async () => (await getTopPages(period)).data,
  });
}

export function useEngagement(period: Period) {
  return useQuery({
    queryKey: ['engagement', period],
    queryFn: async () => (await getEngagement(period)).data,
  });
}

export function useLiveUsers() {
  return useQuery({
    queryKey: ['liveUsers'],
    queryFn: async () => (await getLiveUsers()).data,
    refetchInterval: 30_000,
  });
}

export function useVisitors(offset: number, limit = 10) {
  return useQuery({
    queryKey: ['visitors', offset, limit],
    queryFn: async () => (await getVisitors(offset, limit)).data,
  });
}

export function useAccount() {
  return useQuery({
    queryKey: ['account'],
    queryFn: async () => (await getAccount()).data,
  });
}
