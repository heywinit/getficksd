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

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginFormProps = React.ComponentProps<"div"> & {
  onSwitchToSignup: () => void;
  redirectTo?: string;
};

export function LoginForm({
  className,
  onSwitchToSignup,
  redirectTo = "/dashboard",
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGooglePending, setIsGooglePending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors({
        email: fieldErrors.email?.[0] ?? "",
        password: fieldErrors.password?.[0] ?? "",
      });
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    const response = await authClient.signIn.email({
      email: result.data.email,
      password: result.data.password,
      callbackURL: redirectTo,
    });

    setIsSubmitting(false);

    if (response.error) {
      const message = response.error.message ?? "Sign in failed.";
      setFormError(message);
      toast.error(message);
      return;
    }

    toast.success("Welcome back.");
    window.location.assign(redirectTo);
  }

  async function handleGoogleSignIn() {
    setFormError(undefined);
    setIsGooglePending(true);

    const response = await authClient.signIn.social({
      provider: "google",
      callbackURL: redirectTo,
    });

    if (response.error) {
      const message = response.error.message ?? "Google sign in failed.";
      setFormError(message);
      setIsGooglePending(false);
      toast.error(message);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Sign in with your Google account or email address</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field>
                <Button
                  variant="outline"
                  type="button"
                  disabled={isSubmitting || isGooglePending}
                  onClick={handleGoogleSignIn}
                >
                  <GoogleIcon />
                  {isGooglePending ? "Connecting..." : "Login with Google"}
                </Button>
              </Field>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or continue with
              </FieldSeparator>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="login-email">Email</FieldLabel>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  required
                />
                <FieldError>{errors.email}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  required
                />
                <FieldError>{errors.password}</FieldError>
              </Field>
              {formError ? <FieldError>{formError}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={isSubmitting || isGooglePending}>
                  {isSubmitting ? "Signing in..." : "Login"}
                </Button>
                <FieldDescription className="text-center">
                  Do not have an account?{" "}
                  <button
                    className="underline underline-offset-4 hover:text-primary"
                    type="button"
                    onClick={onSwitchToSignup}
                  >
                    Sign up
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
