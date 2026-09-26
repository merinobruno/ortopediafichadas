export class DomainRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainRejection";
  }
}
