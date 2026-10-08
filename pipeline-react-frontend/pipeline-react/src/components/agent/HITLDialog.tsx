import { Modal, Input } from 'antd';
import { useState } from 'react';
import SchemeSelector from './SchemeSelector';
import type { HITLRequest, HITLResponse } from '../../types/agent';

interface HITLDialogProps {
  request: HITLRequest | null;
  onSubmit: (response: HITLResponse) => Promise<void>;
  onCancel?: () => void;
}

export default function HITLDialog({ request, onSubmit, onCancel }: HITLDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const visible = Boolean(request);

  const handleOk = async () => {
    if (!request || !selected) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        request_id: request.request_id,
        selected_option: selected,
        comment,
      });
      setComment('');
      setSelected(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={request?.title ?? '人工确认'}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      okText="确认选择"
      cancelText="取消"
      confirmLoading={submitting}
      width={900}
    >
      <p>{request?.description}</p>
      {request?.options ? (
        <SchemeSelector
          options={request.options}
          value={selected}
          onChange={setSelected}
        />
      ) : null}
      <Input.TextArea
        style={{ marginTop: 12 }}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="备注（可选）"
      />
    </Modal>
  );
}
