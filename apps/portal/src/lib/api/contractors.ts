import { apiClient } from './client';
import {
  ContractorListSchema,
  ContractorSchema,
  type Contractor,
  type ContractorCreateInput,
  type ContractorList,
  type ContractorUpdateInput,
} from './schemas';

export async function listContractors(accessToken: string): Promise<ContractorList> {
  return apiClient.get<ContractorList>('/contractors', ContractorListSchema, accessToken);
}

export async function getContractor(accessToken: string, id: string): Promise<Contractor> {
  return apiClient.get<Contractor>(`/contractors/${id}`, ContractorSchema, accessToken);
}

export async function createContractor(
  accessToken: string,
  input: ContractorCreateInput,
): Promise<Contractor> {
  return apiClient.post<Contractor>('/contractors', input, ContractorSchema, accessToken);
}

export async function updateContractor(
  accessToken: string,
  id: string,
  input: ContractorUpdateInput,
): Promise<Contractor> {
  return apiClient.patch<Contractor>(`/contractors/${id}`, input, ContractorSchema, accessToken);
}

export async function deleteContractor(accessToken: string, id: string): Promise<void> {
  return apiClient.delete(`/contractors/${id}`, accessToken);
}
