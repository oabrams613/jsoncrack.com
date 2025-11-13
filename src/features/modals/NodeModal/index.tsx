import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton,  Button, Group, Textarea } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useJson from "../../../store/useJson";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useFile from "../../../store/useFile";


// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);

  const initialContent = normalizeNodeData(nodeData?.text ?? []);

  const [baseline, setBaseline] = React.useState(initialContent);
  const [draft, setDraft] = React.useState(initialContent);
  const [isEditing, setIsEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // When the selected node or modal open state changes, reset everything
  React.useEffect(() => {
    const content = normalizeNodeData(nodeData?.text ?? []);
    setBaseline(content);   // last saved version for this node
    setDraft(content);      // what shows in the textarea when you hit Edit
    setIsEditing(false);
    setError(null);
  }, [nodeData, opened]);


  const handleEdit = () => {
    setIsEditing(true);
    setError(null);
  };

  const handleCancel = () => {
    // discard changes and revert to last saved state
    setDraft(baseline);
    setIsEditing(false);
    setError(null);
  };


  const handleSave = () => {
    try {
      // 1) Parse the edited JSON for this node
      const parsedNodeValue = draft.trim() === "" ? {} : JSON.parse(draft);
      setError(null);
  
      if (!nodeData) {
        setIsEditing(false);
        return;
      }
  
      // 2) Use useJson (graph source of truth) as the base document
      const jsonStore = useJson.getState();
      const fileStore = useFile.getState();
  
      // Prefer jsonStore.json, fall back to getJson if your version has it
      const currentJsonStr =
        (jsonStore as any).json ??
        (typeof (jsonStore as any).getJson === "function"
          ? (jsonStore as any).getJson()
          : "{}");
  
      let root: any;
      try {
        root = JSON.parse(currentJsonStr || "{}");
      } catch {
        // If the JSON is somehow broken, treat the edited node as the whole document
        const newJson = JSON.stringify(parsedNodeValue, null, 2);
        jsonStore.setJson(newJson);
        fileStore.setContents({ contents: newJson, hasChanges: true });
        setBaseline(newJson);
        setDraft(newJson);
        setIsEditing(false);
        return;
      }
  
      const path = nodeData.path ?? [];
  
      // If the node is the root, just replace the whole JSON
      if (path.length === 0) {
        const newJson = JSON.stringify(parsedNodeValue, null, 2);
        jsonStore.setJson(newJson); // updates json + graph
        fileStore.setContents({ contents: newJson, hasChanges: true }); // updates editor
        setBaseline(newJson);
        setDraft(newJson);
        setIsEditing(false);
        return;
      }
  
      // 3) Walk to the parent of this node in the JSON tree
      let parent: any = root;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        parent = parent[seg as any];
  
        if (parent === undefined || parent === null) {
          throw new Error("Invalid JSON path for this node");
        }
      }
  
      const last = path[path.length - 1];
      const existingValue = parent[last as any];
  
      const isPlainObject = (v: unknown) =>
        typeof v === "object" && v !== null && !Array.isArray(v);
  
      // 4) Merge into the existing value so other fields stay
      let newNodeValue: any;
      if (isPlainObject(existingValue) && isPlainObject(parsedNodeValue)) {
        newNodeValue = { ...(existingValue as any), ...(parsedNodeValue as any) };
      } else {
        newNodeValue = parsedNodeValue;
      }
  
      parent[last as any] = newNodeValue;
  
          // 5) Serialize and push through stores
    const updatedJsonStr = JSON.stringify(root, null, 2);
    jsonStore.setJson(updatedJsonStr);
    fileStore.setContents({ contents: updatedJsonStr, hasChanges: true });

    // 6) Update baseline/draft, but only with "flat" fields
    const updatedValue = parent[last as any];

    const buildFlatBaseline = (val: unknown): string => {
      // If this node is an object, keep only non-object / non-array props,
      // just like normalizeNodeData does
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const flat: Record<string, unknown> = {};
        Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
          const isObject = typeof v === "object" && v !== null;
          const isArray = Array.isArray(v);
          if (!isObject || isArray) {
            flat[k] = v;
          }
        });
        return JSON.stringify(flat, null, 2);
      }

      // Primitive or array: just stringify
      if (typeof val === "string") {
        return val;
      }
      return JSON.stringify(val, null, 2);
    };

    const newBaseline = buildFlatBaseline(updatedValue);

    setBaseline(newBaseline);
    setDraft(newBaseline);
    setIsEditing(false);

    } catch (e) {
      setError("Invalid JSON. Please fix the syntax before saving.");
    }
  };
  

  




  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <CloseButton onClick={onClose} />
          </Flex>
          <ScrollArea.Autosize mah={250} maw={600}>
  {isEditing ? (
    <Textarea
      value={draft}
      onChange={event => setDraft(event.currentTarget.value)}
      autosize
      minRows={6}
      styles={{
        input: {
          fontFamily: "monospace",
          fontSize: "12px",
        },
      }}
    />
  ) : (
    <CodeHighlight
      code={baseline}   // ⬅️ use baseline here
      miw={350}
      maw={600}
      language="json"
      withCopyButton
    />
  )}
</ScrollArea.Autosize>

          {error && (
          <Text fz="xs" c="red.6">
            {error}
          </Text>
        )}

        <Group justify="flex-end" mt="xs">
          {!isEditing && (
            <Button size="xs" variant="light" onClick={handleEdit}>
              Edit
            </Button>
          )}

          {isEditing && (
            <>
              <Button size="xs" variant="default" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="xs" onClick={handleSave}>
                Save
              </Button>
            </>
          )}
        </Group>

        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
