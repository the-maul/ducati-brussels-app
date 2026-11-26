import { describe, expect, test } from 'bun:test';
import { connectorOk, dcsConnectorState } from '../src/lib/connector-status-rules';

describe('voyant DCS de la barre du haut', () => {
  test('sans reponse : extension absente', () => {
    expect(dcsConnectorState(null)).toBe('no_extension');
  });
  test('reponse sans etat du portail : extension trop ancienne', () => {
    expect(dcsConnectorState({ installed: true, armed: false })).toBe('old_extension');
  });
  test('etat du portail repris tel quel, vert seulement si connecte', () => {
    expect(dcsConnectorState({ installed: true, portal: 'connected' })).toBe('connected');
    expect(dcsConnectorState({ installed: true, portal: 'login' })).toBe('login');
    expect(dcsConnectorState({ installed: true, portal: 'none' })).toBe('none');
    expect(connectorOk('connected')).toBe(true);
    expect(connectorOk('login')).toBe(false);
  });
});
