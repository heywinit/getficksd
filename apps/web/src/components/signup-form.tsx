import { Button } from "@getficksd/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@getficksd/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@getficksd/ui/components/field";
import { Input } from "@getficksd/ui/components/input";
import { cn } from "@getficksd/ui/lib/utils";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { GoogleIcon } from "@/components/google-icon";

const signupSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name."),
    email: z.string().trim().email("Enter a valid email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

type SignupFormProps = React.ComponentProps<"div"> & {
  onSwitchToLogin: () => void;
  redirectTo?: string;
};

export function SignupForm({
  className,
  onSwitchToLogin,
  redirectTo = "/dashboard",
  ...props
}: SignupFormProps) {
  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGooglePending, setIsGooglePending] = useState(false);

  function updateValue(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const result = signupSchema.safeParse(values);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0] ?? "",
        email: fieldErrors.email?.[0] ?? "",
        password: fieldErrors.password?.[0] ?? "",
        confirmPassword: fieldErrors.confirmPassword?.[0] ?? "",
      });
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    const response = await authClient.signUp.email({
      name: result.data.name,
      email: result.data.email,
      password: result.data.password,
      callbackURL: redirectTo,
    });

    setIsSubmitting(false);

    if (response.error) {
      const message = response.error.message ?? "Account creation failed.";
      setFormError(message);
      toast.error(message);
      return;
    }

    toast.success("Your account is ready.");
    window.location.assign(redirectTo);
  }

  async function handleGoogleSignUp() {
    setFormError(undefined);
    setIsGooglePending(true);

    const response = await authClient.signIn.social({
      provider: "google",
      callbackURL: redirectTo,
    });

    if (response.error) {
      const message = response.error.message ?? "Google sign up failed.";
      setFormError(message);
      setIsGooglePending(false);
      toast.error(message);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>Sign up with your Google account or email address</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field>
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSubmitting || isGooglePending}
                  onClick={handleGoogleSignUp}
                >
                  <GoogleIcon />
                  {isGooglePending ? "Connecting..." : "Sign up with Google"}
                </Button>
              </Field>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or continue with
              </FieldSeparator>
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="signup-name">Full name</FieldLabel>
                <Input
                  id="signup-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="John Doe"
                  value={values.name}
                  onChange={(event) => updateValue("name", event.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  required
                />
                <FieldError>{errors.name}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="signup-email">Email</FieldLabel>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  value={values.email}
                  onChange={(event) => updateValue("email", event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  required
                />
                <FieldError>{errors.email}</FieldError>
              </Field>
              <Field>
                <Field className="grid grid-cols-2 gap-4">
                  <Field data-invalid={Boolean(errors.password)}>
                    <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                    <Input
                      id="signup-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      value={values.password}
                      onChange={(event) => updateValue("password", event.target.value)}
                      aria-invalid={Boolean(errors.password)}
                      required
                    />
                    <FieldError>{errors.password}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(errors.confirmPassword)}>
                    <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={values.confirmPassword}
                      onChange={(event) => updateValue("confirmPassword", event.target.value)}
                      aria-invalid={Boolean(errors.confirmPassword)}
                      required
                    />
                    <FieldError>{errors.confirmPassword}</FieldError>
                  </Field>
                </Field>
                <FieldDescription>Must be at least 8 characters long.</FieldDescription>
              </Field>
              {formError ? <FieldError>{formError}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={isSubmitting || isGooglePending}>
                  {isSubmitting ? "Creating account..." : "Create account"}
                </Button>
                <FieldDescription className="text-center">
                  Already have an account?{" "}
                  <button
                    className="underline underline-offset-4 hover:text-primary"
                    type="button"
                    onClick={onSwitchToLogin}
                  >
                    Sign in
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a> and{" "}
        <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
