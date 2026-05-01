export type WebMessages = {
  metadata: {
    title: string;
    description: string;
  };
  header: {
    brand: string;
    signIn: string;
    signOut: string;
  };
};