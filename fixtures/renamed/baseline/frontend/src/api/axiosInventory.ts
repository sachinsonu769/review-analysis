import axios from 'axios';

export async function resolveWithAxios() {
  return axios.get('/api/inventory/search');
}
