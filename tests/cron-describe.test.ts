/**
 * Mise en production (revue UX/UI du 20/11/2026) : fréquences des tâches du serveur dites en
 * français, à l'heure de Bruxelles (pg_cron tourne en UTC).
 */
import { describe, expect, test } from 'bun:test';
import { describeCron } from '../src/modules/settings/cron-describe';

const WINTER = new Date(Date.UTC(2026, 10, 20, 12)); // 20/11/2026 : UTC+1
const SUMMER = new Date(Date.UTC(2026, 6, 15, 12)); // 15/07/2026 : UTC+2

describe('describeCron — heure de Bruxelles', () => {
  test('« 30 23 * * * » : tous les jours à 00:30 en hiver, 01:30 en été', () => {
    expect(describeCron('30 23 * * *', WINTER)).toEqual({ key: 'daily_at', vars: { time: '00:30' } });
    expect(describeCron('30 23 * * *', SUMMER)).toEqual({ key: 'daily_at', vars: { time: '01:30' } });
  });

  test('heure fixe du matin', () => {
    expect(describeCron('15 6 * * *', WINTER)).toEqual({ key: 'daily_at', vars: { time: '07:15' } });
  });

  test('toutes les n minutes, toutes les minutes, toutes les heures', () => {
    expect(describeCron('*/5 * * * *', WINTER)).toEqual({ key: 'every_minutes', vars: { n: '5' } });
    expect(describeCron('* * * * *', WINTER)).toEqual({ key: 'every_minute', vars: {} });
    expect(describeCron('5 * * * *', WINTER)).toEqual({ key: 'hourly_at', vars: { min: ':05' } });
    expect(describeCron('0 */2 * * *', WINTER)).toEqual({ key: 'every_hours', vars: { n: '2', min: ':00' } });
  });

  test('le 1er du mois à 05:00 UTC → 06:00 à Bruxelles', () => {
    expect(describeCron('0 5 1 * *', WINTER)).toEqual({ key: 'monthly_at', vars: { d: '1', time: '06:00' } });
  });

  test('chaque semaine : le jour peut changer avec le décalage', () => {
    expect(describeCron('0 8 * * 1', WINTER)).toEqual({ key: 'weekly_at', vars: { dayIndex: '1', time: '09:00' } });
    // Dimanche 23:30 UTC = lundi 00:30 à Bruxelles en hiver.
    expect(describeCron('30 23 * * 0', WINTER)).toEqual({ key: 'weekly_at', vars: { dayIndex: '1', time: '00:30' } });
  });

  test('ce qui ne rentre dans aucun cas est rendu tel quel', () => {
    expect(describeCron('0 9 * 1 *', WINTER)).toEqual({ key: 'raw', vars: { expr: '0 9 * 1 *' } });
    expect(describeCron('n importe quoi', WINTER).key).toBe('raw');
    expect(describeCron('0 9-17 * * *', WINTER).key).toBe('raw');
  });
});
