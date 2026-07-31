import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    sid?: string;
    user: {
      id: string;
      email?: string | null;
    };
  }

  interface User {
    sid?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sid?: string;
  }
}
