import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { Button } from "@getficksd/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@getficksd/ui/components/field";
import { Input } from "@getficksd/ui/components/input";
import { Textarea } from "@getficksd/ui/components/textarea";
import { useId, type ComponentProps } from "react";

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

type CommonFieldProps = {
  label: string;
  description?: string;
};

type TextFieldProps = CommonFieldProps &
  Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "onBlur">;

function TextField({ label, description, id: suppliedId, ...props }: TextFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const field = useFieldContext<string>();
  const errors = getFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        id={id}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={errors} />
    </Field>
  );
}

type TextareaFieldProps = CommonFieldProps &
  Omit<ComponentProps<typeof Textarea>, "value" | "defaultValue" | "onChange" | "onBlur">;

function TextareaField({ label, description, id: suppliedId, ...props }: TextareaFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const field = useFieldContext<string>();
  const errors = getFieldErrors(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && errors.length > 0;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        {...props}
        id={id}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError errors={errors} />
    </Field>
  );
}

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type" | "children"> & {
  children: string;
  pendingLabel?: string;
};

function SubmitButton({ children, pendingLabel = "Saving...", ...props }: SubmitButtonProps) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
      {([canSubmit, isSubmitting]) => (
        <Button {...props} type="submit" disabled={!canSubmit || isSubmitting || props.disabled}>
          {isSubmitting ? pendingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  );
}

function getFieldErrors(errors: unknown[]) {
  return errors.flatMap((error) => {
    if (typeof error === "string") {
      return [{ message: error }];
    }

    if (error && typeof error === "object" && "message" in error) {
      return [{ message: String(error.message) }];
    }

    return [];
  });
}

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: { TextField, TextareaField },
  formComponents: { SubmitButton },
  fieldContext,
  formContext,
});
