import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStepsAsNumberedList } from './formatSteps';

test('removes AI Step X prefixes before applying list numbering', () => {
  const input = [
    'Step 1: Log in to the Sticky.io admin dashboard.',
    'Step 2: Observe the notification bell icon in the top right header.',
    "Step 3: Navigate to the 'Notifications' module under Settings.",
    'Step 4: Verify the System Notifications table content.'
  ].join('\n');

  assert.equal(
    formatStepsAsNumberedList(input),
    [
      '1. Log in to the Sticky.io admin dashboard.',
      '2. Observe the notification bell icon in the top right header.',
      "3. Navigate to the 'Notifications' module under Settings.",
      '4. Verify the System Notifications table content.'
    ].join('\n')
  );
});
