export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const React: typeof import('react') = require('react');
const { ReferenceSelect }: typeof import('./OptionSelect') = require('./OptionSelect.tsx');
import type { TaxonomyId } from '../../../../shared/types';

const cloudTaxonomyId = '550e8400-e29b-41d4-a716-446655440000';

test('ReferenceSelect preserves a cloud taxonomy UUID exactly', () => {
  let emittedValue: TaxonomyId | null | undefined;
  const rendered = ReferenceSelect({
    label: 'Application',
    value: cloudTaxonomyId,
    options: [{
      id: cloudTaxonomyId,
      name: 'Cloud Application',
      value: 'Cloud Application',
      sort_order: 0,
      is_active: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }],
    onChange: (value) => {
      emittedValue = value;
    }
  });

  type SelectElement = import('react').ReactElement<{
    onChange: (event: { target: { value: string } }) => void;
  }>;
  const children = React.Children.toArray(
    (rendered as import('react').ReactElement<{ children: import('react').ReactNode }>).props.children
  );
  const select = children.find(
    (child): child is SelectElement => React.isValidElement(child) && child.type === 'select'
  );

  assert.ok(select, 'ReferenceSelect should render a select element');
  select.props.onChange({ target: { value: cloudTaxonomyId } });

  assert.equal(emittedValue, cloudTaxonomyId, 'the original cloud taxonomy ID must be preserved');
});

test('ReferenceSelect preserves a legacy numeric taxonomy ID as a number', () => {
  let emittedValue: TaxonomyId | null | undefined;
  const rendered = ReferenceSelect({
    label: 'Application',
    value: 42,
    options: [{
      id: 42,
      name: 'Legacy Application',
      value: 'Legacy Application',
      sort_order: 0,
      is_active: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }],
    onChange: (value) => {
      emittedValue = value;
    }
  });

  type SelectElement = import('react').ReactElement<{
    onChange: (event: { target: { value: string } }) => void;
  }>;
  const children = React.Children.toArray(
    (rendered as import('react').ReactElement<{ children: import('react').ReactNode }>).props.children
  );
  const select = children.find(
    (child): child is SelectElement => React.isValidElement(child) && child.type === 'select'
  );

  assert.ok(select, 'ReferenceSelect should render a select element');
  select.props.onChange({ target: { value: '42' } });

  assert.equal(emittedValue, 42, 'legacy numeric IDs must remain numeric');
});
