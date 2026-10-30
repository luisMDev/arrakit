import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'

/**
 * Registers a field whose error hides while the person edits it. Pair it with
 * `reValidateMode: 'onSubmit'` so the field is checked again only on the next submit.
 */
export function registerClearing<TValues extends FieldValues, TContext, TOutput>(
  form: UseFormReturn<TValues, TContext, TOutput>,
  name: FieldPath<TValues>,
) {
  return form.register(name, {
    onChange: () => {
      if (form.getFieldState(name).error) form.clearErrors(name)
    },
  })
}
