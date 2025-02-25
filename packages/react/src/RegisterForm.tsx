import {
  GoogleCredentialResponse,
  LoginAuthenticationResponse,
  NewPatientRequest,
  NewProjectRequest,
  parseJWTPayload,
} from '@medplum/core';
import { OperationOutcome } from '@medplum/fhirtypes';
import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { Document } from './Document';
import { Form } from './Form';
import { FormSection } from './FormSection';
import { getGoogleClientId, GoogleButton } from './GoogleButton';
import { Input } from './Input';
import { useMedplum } from './MedplumProvider';
import { getIssuesForExpression } from './utils/outcomes';
import { getRecaptcha, initRecaptcha } from './utils/recaptcha';
import './SignInForm.css';
import './util.css';

export interface BaseRegisterFormProps {
  readonly googleClientId?: string;
  readonly recaptchaSiteKey: string;
  readonly children?: React.ReactNode;
  readonly onSuccess: () => void;
}

export interface PatientRegisterFormProps extends BaseRegisterFormProps {
  readonly type: 'patient';
  readonly projectId: string;
}

export interface ProjectRegisterFormProps extends BaseRegisterFormProps {
  readonly type: 'project';
}

export type RegisterFormProps = PatientRegisterFormProps | ProjectRegisterFormProps;

export function RegisterForm(props: RegisterFormProps): JSX.Element {
  const medplum = useMedplum();
  const googleClientId = getGoogleClientId(props.googleClientId);
  const recaptchaSiteKey = props.recaptchaSiteKey;
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const issues = getIssuesForExpression(outcome, undefined);

  useEffect(() => initRecaptcha(recaptchaSiteKey), [recaptchaSiteKey]);

  async function handleAuthResponse(
    registerRequest: NewPatientRequest | NewProjectRequest,
    partialLogin: LoginAuthenticationResponse
  ): Promise<void> {
    try {
      let login;
      if (props.type === 'patient') {
        login = await medplum.startNewPatient(registerRequest as NewPatientRequest, partialLogin);
      } else {
        login = await medplum.startNewProject(registerRequest as NewProjectRequest, partialLogin);
      }
      await medplum.processCode(login.code as string);
      props.onSuccess();
    } catch (err) {
      setOutcome(err as OperationOutcome);
    }
  }

  return (
    <Document width={450}>
      <Form
        style={{ maxWidth: 400 }}
        onSubmit={async (formData: Record<string, string>) => {
          try {
            const recaptchaToken = await getRecaptcha(recaptchaSiteKey);
            const registerRequest = {
              projectId: (props as PatientRegisterFormProps).projectId,
              projectName: formData.projectName,
              firstName: formData.firstName,
              lastName: formData.lastName,
              email: formData.email,
              password: formData.password,
              remember: formData.remember === 'true',
              recaptchaSiteKey,
              recaptchaToken,
            };
            const userLogin = await medplum.startNewUser(registerRequest);
            await handleAuthResponse(registerRequest, userLogin);
          } catch (err) {
            setOutcome(err as OperationOutcome);
          }
        }}
      >
        <div className="medplum-center">{props.children}</div>
        {issues && (
          <div className="medplum-input-error">
            {issues.map((issue) => (
              <div data-testid="text-field-error" key={issue.details?.text}>
                {issue.details?.text}
              </div>
            ))}
          </div>
        )}
        {googleClientId && (
          <>
            <div className="medplum-signin-google-container">
              <GoogleButton
                googleClientId={googleClientId}
                handleGoogleCredential={async (response: GoogleCredentialResponse) => {
                  try {
                    const loginRequest = {
                      googleClientId: response.clientId,
                      googleCredential: response.credential,
                    };
                    const userLogin = await medplum.startGoogleLogin(loginRequest);
                    const googleClaims = parseJWTPayload(loginRequest.googleCredential);
                    const registerRequest = {
                      projectId: (props as PatientRegisterFormProps).projectId,
                      firstName: googleClaims.given_name as string,
                      lastName: googleClaims.family_name as string,
                      email: googleClaims.email as string,
                    };
                    await handleAuthResponse(registerRequest, userLogin);
                  } catch (err) {
                    setOutcome(err as OperationOutcome);
                  }
                }}
              />
            </div>
            <div className="medplum-signin-separator">or</div>
          </>
        )}
        <FormSection title="First Name" htmlFor="firstName" outcome={outcome}>
          <Input
            name="firstName"
            type="text"
            testid="firstName"
            placeholder="First name"
            required={true}
            autoFocus={true}
            outcome={outcome}
          />
        </FormSection>
        <FormSection title="Last Name" htmlFor="lastName" outcome={outcome}>
          <Input
            name="lastName"
            type="text"
            testid="lastName"
            placeholder="Last name"
            required={true}
            outcome={outcome}
          />
        </FormSection>
        {props.type === 'project' && (
          <FormSection title="Project Name" htmlFor="projectName" outcome={outcome}>
            <Input
              name="projectName"
              type="text"
              testid="projectName"
              placeholder="My Project"
              required={true}
              outcome={outcome}
            />
          </FormSection>
        )}
        <FormSection title="Email" htmlFor="email" outcome={outcome}>
          <Input
            name="email"
            type="email"
            testid="email"
            placeholder="name@domain.com"
            required={true}
            outcome={outcome}
          />
        </FormSection>
        <FormSection title="Password" htmlFor="password" outcome={outcome}>
          <Input
            name="password"
            type="password"
            testid="password"
            autoComplete="off"
            required={true}
            outcome={outcome}
          />
        </FormSection>
        <p style={{ fontSize: '12px', color: '#888' }}>
          By clicking submit you agree to the Medplum <a href="https://www.medplum.com/privacy">Privacy&nbsp;Policy</a>
          {' and '}
          <a href="https://www.medplum.com/terms">Terms&nbsp;of&nbsp;Service</a>.
        </p>
        <p style={{ fontSize: '12px', color: '#888' }}>
          This site is protected by reCAPTCHA and the Google{' '}
          <a href="https://policies.google.com/privacy">Privacy&nbsp;Policy</a>
          {' and '}
          <a href="https://policies.google.com/terms">Terms&nbsp;of&nbsp;Service</a> apply.
        </p>
        <div className="medplum-signin-buttons">
          <div>
            <input type="checkbox" id="remember" name="remember" value="true" />
            <label htmlFor="remember">Remember me</label>
          </div>
          <div>
            <Button type="submit" testid="submit">
              Create account
            </Button>
          </div>
        </div>
      </Form>
    </Document>
  );
}
