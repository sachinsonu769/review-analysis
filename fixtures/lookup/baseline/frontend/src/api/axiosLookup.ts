import axios from 'axios';

export async function lookupWithAxios() {
  return axios.get('/api/lookup');
}
