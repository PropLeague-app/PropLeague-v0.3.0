import { useNavigate } from 'react-router-dom';
import { HowItWorksSheet } from '../../components/common/HowItWorksSheet';

export function HowItWorks() {
  const navigate = useNavigate();
  return <HowItWorksSheet settings={null} onClose={() => navigate(-1)} />;
}
