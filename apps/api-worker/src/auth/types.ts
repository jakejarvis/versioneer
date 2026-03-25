export interface AuthUser {
  email: string;
  sub: string;
}

export interface AuthVariables {
  user: AuthUser;
}
