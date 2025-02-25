import { badRequest, Operator } from '@medplum/core';
import { OperationOutcome, Project, User } from '@medplum/fhirtypes';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { pwnedPassword } from 'hibp';
import { getConfig } from '../config';
import { invalidRequest, sendOutcome, systemRepo } from '../fhir';
import { logger } from '../logger';
import { getUserByEmail, tryLogin } from '../oauth';
import { verifyRecaptcha } from './utils';

export interface NewUserRequest {
  readonly projectId?: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly password: string;
  readonly recaptchaToken: string;
}

export const newUserValidators = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email address is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('recaptchaToken').notEmpty().withMessage('Recaptcha token is required'),
];

/**
 * Handles a HTTP request to /auth/newuser.
 * @param req The HTTP request.
 * @param res The HTTP response.
 */
export async function newUserHandler(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendOutcome(res, invalidRequest(errors));
    return;
  }

  const recaptchaSiteKey = req.body.recaptchaSiteKey;
  let secretKey: string | undefined = getConfig().recaptchaSecretKey;
  let project: Project | undefined;

  if (recaptchaSiteKey !== getConfig().recaptchaSiteKey) {
    // If the recaptcha site key is not the main Medplum recaptcha site key,
    // then it must be associated with a Project.
    // The user can only authenticate with that project.
    project = await getProjectByRecaptchaSiteKey(recaptchaSiteKey);
    if (!project) {
      sendOutcome(res, badRequest('Invalid recaptchaSiteKey'));
      return;
    }
    secretKey = project.site?.find((s) => s.recaptchaSiteKey === recaptchaSiteKey)?.recaptchaSecretKey;
    if (!secretKey) {
      sendOutcome(res, badRequest('Invalid recaptchaSecretKey'));
      return;
    }
  }

  if (!(await verifyRecaptcha(secretKey as string, req.body.recaptchaToken))) {
    sendOutcome(res, badRequest('Recaptcha failed'));
    return;
  }

  const existingUser = await getUserByEmail(req.body.email, req.body.projectId);
  if (existingUser) {
    sendOutcome(res, badRequest('Email already registered', 'email'));
    return;
  }

  try {
    await createUser(req.body as NewUserRequest);

    const login = await tryLogin({
      authMethod: 'password',
      projectId: req.body.projectId || undefined,
      scope: req.body.scope || 'openid',
      nonce: req.body.nonce || randomUUID(),
      codeChallenge: req.body.codeChallenge,
      codeChallengeMethod: req.body.codeChallengeMethod,
      email: req.body.email,
      password: req.body.password,
      remember: req.body.remember,
      remoteAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.status(200).json({ login: login?.id });
  } catch (outcome) {
    sendOutcome(res, outcome as OperationOutcome);
  }
}

export async function createUser(request: NewUserRequest): Promise<User> {
  const { firstName, lastName, email, password } = request;

  const numPwns = await pwnedPassword(password);
  if (numPwns > 0) {
    return Promise.reject(badRequest('Password found in breach database', 'password'));
  }

  logger.info('Create user ' + email);
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await systemRepo.createResource<User>({
    resourceType: 'User',
    firstName,
    lastName,
    email,
    passwordHash,
  });
  logger.info('Created: ' + result.id);
  return result;
}

async function getProjectByRecaptchaSiteKey(recaptchaSiteKey: string): Promise<Project | undefined> {
  const bundle = await systemRepo.search<Project>({
    resourceType: 'Project',
    count: 1,
    filters: [
      {
        code: 'recaptcha-site-key',
        operator: Operator.EQUALS,
        value: recaptchaSiteKey,
      },
    ],
  });
  return bundle.entry && bundle.entry.length > 0 ? bundle.entry[0].resource : undefined;
}
