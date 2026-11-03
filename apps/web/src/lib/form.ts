import { personNameRefusal } from '@arrakit/address'
import { type FieldValues, type UseFormProps, type UseFormReturn, useForm } from 'react-hook-form'
import { z } from 'zod'

/**
 * A form whose field errors appear on submit and stay hidden until the next submit once edited:
 * every field it registers hides its error while the person edits it.
 */
export function useClearingForm<TValues extends FieldValues, TContext = unknown, TOutput = TValues>(
  props: Omit<UseFormProps<TValues, TContext, TOutput>, 'reValidateMode'>,
): UseFormReturn<TValues, TContext, TOutput> {
  const form = useForm({ ...props, reValidateMode: 'onSubmit' })
  const register: typeof form.register = (name, options) =>
    form.register(name, {
      ...options,
      onChange: (event: unknown) => {
        if (form.getFieldState(name).error) form.clearErrors(name)
        return options?.onChange?.(event)
      },
    } as typeof options)
  return { ...form, register }
}

/** A form with one required `name` of up to `max` characters; `message` says it is missing. */
export const nameForm = (
  message?: string,
  { max = 200, tooLong }: { max?: number; tooLong?: string } = {},
) => z.object({ name: z.string().trim().min(1, message).max(max, tooLong) })

/** A person's name the address rules accept, trimmed. */
export const personNameField = z
  .string()
  .trim()
  .refine((name) => personNameRefusal(name) === null)
