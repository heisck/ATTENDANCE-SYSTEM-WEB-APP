declare module "web-push" {
  type PushSubscription = {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  type VapidDetails = {
    subject: string;
    publicKey: string;
    privateKey: string;
  };

  function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

  function sendNotification(
    subscription: PushSubscription,
    payload?: string
  ): Promise<unknown>;

  const webpush: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };

  export default webpush;
}
