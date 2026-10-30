import {
  type FieldPath,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
  useForm,
} from 'react-hook-form'

/** A form whose field errors appear on submit and stay hidden until the next submit once edited. */
export function useClearingForm<TValues extends FieldValues, TContext = unknown, TOutput = TValues>(
  props: Omit<UseFormProps<TValues, TContext, TOutput>, 'reValidateMode'>,
): UseFormReturn<TValues, TContext, TOutput> {
  return useForm({ ...props, reValidateMode: 'onSubmit' })
}

/** Registers a field of a `useClearingForm` form: its error hides while the person edits it. */
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
