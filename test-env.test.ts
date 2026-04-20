import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  snapshotEnv,
  restoreEnv,
  clearEnvKeys,
  setEnvValue,
  mergeProcessEnv,
} from './test-env.js';

describe('test-env', () => {
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save the current environment without replacing process.env itself.
    originalEnv = snapshotEnv(Object.keys(process.env));
  });

  afterEach(() => {
    // Restore in place so any references to process.env stay valid.
    clearEnvKeys(Object.keys(process.env));
    restoreEnv(originalEnv);
  });

  describe('snapshotEnv', () => {
    it('should snapshot specified environment variables', () => {
      process.env.TEST_VAR_1 = 'value1';
      process.env.TEST_VAR_2 = 'value2';

      const snapshot = snapshotEnv(['TEST_VAR_1', 'TEST_VAR_2', 'TEST_VAR_MISSING']);

      expect(snapshot).toEqual({
        TEST_VAR_1: 'value1',
        TEST_VAR_2: 'value2',
        TEST_VAR_MISSING: undefined,
      });
    });
  });

  describe('restoreEnv', () => {
    it('should restore environment variables from snapshot', () => {
      process.env.TEST_VAR_1 = 'modified_value1';
      delete process.env.TEST_VAR_2;
      process.env.TEST_VAR_MISSING = 'now_exists';

      const snapshot = {
        TEST_VAR_1: 'value1',
        TEST_VAR_2: 'value2',
        TEST_VAR_MISSING: undefined,
      };

      restoreEnv(snapshot);

      expect(process.env.TEST_VAR_1).toBe('value1');
      expect(process.env.TEST_VAR_2).toBe('value2');
      expect(process.env.TEST_VAR_MISSING).toBeUndefined();
    });
  });

  describe('clearEnvKeys', () => {
    it('should remove specified keys from process.env', () => {
      process.env.TEST_KEY_TO_CLEAR_1 = 'val1';
      process.env.TEST_KEY_TO_CLEAR_2 = 'val2';

      clearEnvKeys(['TEST_KEY_TO_CLEAR_1', 'TEST_KEY_TO_CLEAR_2']);

      expect(process.env.TEST_KEY_TO_CLEAR_1).toBeUndefined();
      expect(process.env.TEST_KEY_TO_CLEAR_2).toBeUndefined();
    });
  });

  describe('setEnvValue', () => {
    it('should set an environment variable when value is defined', () => {
      setEnvValue('TEST_SET_ENV', 'my_value');
      expect(process.env.TEST_SET_ENV).toBe('my_value');
    });

    it('should delete an environment variable when value is undefined', () => {
      process.env.TEST_DELETE_ENV = 'exists';
      setEnvValue('TEST_DELETE_ENV', undefined);
      expect(process.env.TEST_DELETE_ENV).toBeUndefined();
    });
  });

  describe('mergeProcessEnv', () => {
    it('should merge overrides with process.env without mutating original', () => {
      process.env.EXISTING_VAR = 'existing';
      const overrides = { NEW_VAR: 'new', EXISTING_VAR: 'overridden' };

      const merged = mergeProcessEnv(overrides);

      expect(merged).toEqual({
        ...process.env,
        ...overrides,
      });

      // Original process.env should be untouched for NEW_VAR and EXISTING_VAR should remain
      expect(process.env.NEW_VAR).toBeUndefined();
      expect(process.env.EXISTING_VAR).toBe('existing');
    });
  });
});
