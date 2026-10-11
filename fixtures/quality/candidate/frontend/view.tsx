import { Order } from './domain/order';
export const view = (message: string) => <article>{message}</article>;
export const model = new Order();
