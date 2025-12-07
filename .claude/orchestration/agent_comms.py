"""
Agent communication utilities for structured handoffs.
"""

import json
import re
from typing import Dict, List, Optional


class AgentHandoff:
    """Structured context passing between agents."""

    @staticmethod
    def create_handoff(
        task_id: str,
        from_agent: str,
        to_agent: str,
        task_name: str,
        task_description: str,
        interfaces: Dict[str, str],
        dependencies: List[str],
        critical_notes: List[str],
        test_requirements: List[str],
        token_budget: int,
        priority: str = 'medium'
    ) -> dict:
        """
        Create a structured handoff with validation.
        Enforces token efficiency rules.

        Args:
            task_id: Unique identifier for the task
            from_agent: Agent creating the handoff ('orchestrator' or agent name)
            to_agent: Agent receiving the handoff
            task_name: Short task description (max 50 chars)
            task_description: Detailed description (max 200 chars)
            interfaces: TypeScript interface definitions
            dependencies: File paths to read (max 5)
            critical_notes: Important constraints (max 3, <100 chars each)
            test_requirements: Coverage expectations (max 3)
            token_budget: Max tokens for this task (500-3000)
            priority: Task priority ('low', 'medium', 'high')

        Returns:
            Validated handoff dictionary

        Raises:
            ValueError: If validation fails
        """
        # Validate constraints
        errors = []

        if len(task_name) > 50:
            errors.append(f"task_name too long ({len(task_name)} > 50 chars)")

        if len(task_description) > 200:
            errors.append(f"task_description too long ({len(task_description)} > 200 chars)")

        if len(critical_notes) > 3:
            errors.append(f"Too many critical notes ({len(critical_notes)} > 3)")

        for note in critical_notes:
            if len(note) > 100:
                errors.append(f"Critical note too long: '{note[:50]}...'")

        if len(dependencies) > 5:
            errors.append(f"Too many dependencies ({len(dependencies)} > 5)")

        if token_budget < 500 or token_budget > 3000:
            errors.append(f"Token budget out of range ({token_budget} not in 500-3000)")

        if priority not in ['low', 'medium', 'high']:
            errors.append(f"Invalid priority: {priority}")

        if errors:
            raise ValueError("Handoff validation failed:\n" + "\n".join(f"  - {e}" for e in errors))

        # Compress interfaces
        compressed_interfaces = AgentHandoff.compress_interfaces(interfaces)

        handoff = {
            "taskId": task_id,
            "fromAgent": from_agent,
            "toAgent": to_agent,
            "taskName": task_name,
            "taskDescription": task_description,
            "interfaces": compressed_interfaces,
            "dependencies": dependencies,
            "criticalNotes": critical_notes,
            "testRequirements": test_requirements,
            "tokenBudget": token_budget,
            "priority": priority
        }

        # Final token estimate
        estimated_tokens = AgentHandoff.estimate_tokens(handoff)
        if estimated_tokens > 600:
            print(f"⚠️  Warning: Handoff size ({estimated_tokens} tokens) exceeds recommended 500 tokens")

        return handoff

    @staticmethod
    def estimate_tokens(handoff: dict) -> int:
        """
        Estimate token count for this handoff.
        Uses rough approximation: 1 token ≈ 4 characters

        Args:
            handoff: Handoff dictionary

        Returns:
            Estimated token count
        """
        content = json.dumps(handoff, separators=(',', ':'))  # Compact JSON
        return len(content) // 4

    @staticmethod
    def compress_interfaces(interfaces: Dict[str, str]) -> Dict[str, str]:
        """
        Compress TypeScript interfaces by removing comments and whitespace.

        Args:
            interfaces: Dictionary of interface name -> definition

        Returns:
            Compressed interfaces
        """
        compressed = {}

        for name, definition in interfaces.items():
            # Remove single-line comments
            clean = re.sub(r'//.*$', '', definition, flags=re.MULTILINE)

            # Remove multi-line comments
            clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.DOTALL)

            # Remove extra whitespace
            clean = ' '.join(clean.split())

            # Remove spaces around common characters
            clean = clean.replace(' : ', ':')
            clean = clean.replace(' ; ', ';')
            clean = clean.replace(' { ', '{')
            clean = clean.replace(' } ', '}')
            clean = clean.replace(' , ', ',')
            clean = clean.replace('( ', '(')
            clean = clean.replace(' )', ')')

            compressed[name] = clean.strip()

        return compressed

    @staticmethod
    def create_response(
        task_id: str,
        agent_type: str,
        status: str,
        files_modified: List[str],
        files_created: List[str],
        interfaces: Dict[str, str],
        exports: List[str],
        tests: List[str],
        token_usage: int,
        execution_time: float,
        warnings: List[str] = None,
        errors: List[str] = None,
        blockers: List[str] = None
    ) -> dict:
        """
        Create a structured response from an agent.

        Args:
            task_id: Task identifier matching the handoff
            agent_type: Agent that executed the task
            status: 'success', 'error', or 'blocked'
            files_modified: Paths to modified files
            files_created: Paths to created files
            interfaces: New/updated TypeScript interfaces
            exports: New exports from modified files
            tests: Test files created/modified
            token_usage: Actual tokens used
            execution_time: Execution time in seconds
            warnings: Non-blocking issues
            errors: Blocking issues (if status='error')
            blockers: Dependencies needed (if status='blocked')

        Returns:
            Response dictionary
        """
        response = {
            "taskId": task_id,
            "agentType": agent_type,
            "status": status,
            "filesModified": files_modified,
            "filesCreated": files_created,
            "interfaces": AgentHandoff.compress_interfaces(interfaces),
            "exports": exports,
            "tests": tests,
            "tokenUsage": token_usage,
            "executionTime": execution_time,
            "warnings": warnings or []
        }

        if status == 'error' and errors:
            response["errors"] = errors

        if status == 'blocked' and blockers:
            response["blockers"] = blockers

        return response

    @staticmethod
    def validate_response(response: dict) -> List[str]:
        """
        Validate agent response structure.

        Args:
            response: Response dictionary

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        # Required fields
        required = ['taskId', 'agentType', 'status', 'filesModified', 'tokenUsage']
        for field in required:
            if field not in response:
                errors.append(f"Missing required field: {field}")

        # Status validation
        if response.get('status') not in ['success', 'error', 'blocked']:
            errors.append(f"Invalid status: {response.get('status')}")

        # Error status requires errors field
        if response.get('status') == 'error' and 'errors' not in response:
            errors.append("Status 'error' requires 'errors' field")

        # Blocked status requires blockers field
        if response.get('status') == 'blocked' and 'blockers' not in response:
            errors.append("Status 'blocked' requires 'blockers' field")

        return errors

    @staticmethod
    def format_handoff_summary(handoff: dict) -> str:
        """
        Format handoff as human-readable summary.

        Args:
            handoff: Handoff dictionary

        Returns:
            Formatted summary string
        """
        summary = f"""
🎯 Task: {handoff['taskName']}
   ID: {handoff['taskId']}
   From: {handoff['fromAgent']} → To: {handoff['toAgent']}
   Priority: {handoff.get('priority', 'medium').upper()}

📝 Description:
   {handoff['taskDescription']}

🔧 Dependencies ({len(handoff['dependencies'])}):
   {chr(10).join(f'   - {dep}' for dep in handoff['dependencies'])}

⚠️  Critical Notes ({len(handoff['criticalNotes'])}):
   {chr(10).join(f'   - {note}' for note in handoff['criticalNotes'])}

🧪 Test Requirements ({len(handoff['testRequirements'])}):
   {chr(10).join(f'   - {req}' for req in handoff['testRequirements'])}

💾 Token Budget: {handoff['tokenBudget']} tokens
   Estimated Usage: {AgentHandoff.estimate_tokens(handoff)} tokens
"""
        return summary.strip()

    @staticmethod
    def format_response_summary(response: dict) -> str:
        """
        Format response as human-readable summary.

        Args:
            response: Response dictionary

        Returns:
            Formatted summary string
        """
        status_emoji = {
            'success': '✅',
            'error': '❌',
            'blocked': '⏸️'
        }

        emoji = status_emoji.get(response['status'], '❓')

        summary = f"""
{emoji} Task {response['taskId']} - {response['status'].upper()}
   Agent: {response['agentType']}
   Execution Time: {response['executionTime']:.2f}s
   Token Usage: {response['tokenUsage']} tokens

📁 Files Modified ({len(response['filesModified'])}):
   {chr(10).join(f'   - {file}' for file in response['filesModified']) or '   (none)'}

📁 Files Created ({len(response.get('filesCreated', []))}):
   {chr(10).join(f'   - {file}' for file in response.get('filesCreated', [])) or '   (none)'}

🧪 Tests ({len(response.get('tests', []))}):
   {chr(10).join(f'   - {test}' for test in response.get('tests', [])) or '   (none)'}
"""

        if response.get('warnings'):
            summary += f"\n⚠️  Warnings:\n   {chr(10).join(f'   - {w}' for w in response['warnings'])}"

        if response.get('errors'):
            summary += f"\n❌ Errors:\n   {chr(10).join(f'   - {e}' for e in response['errors'])}"

        if response.get('blockers'):
            summary += f"\n⏸️  Blockers:\n   {chr(10).join(f'   - {b}' for b in response['blockers'])}"

        return summary.strip()


# Example usage
if __name__ == '__main__':
    # Create example handoff
    handoff = AgentHandoff.create_handoff(
        task_id='haptic-toggle-001',
        from_agent='orchestrator',
        to_agent='frontend',
        task_name='Add haptic toggle button',
        task_description='Add toggle button to SettingsPanel for haptic feedback control',
        interfaces={
            'HapticToggleProps': 'interface HapticToggleProps { enabled: boolean; onChange: (enabled: boolean) => void }'
        },
        dependencies=[
            'src/components/panels/SettingsPanel.tsx',
            'src/store/useUIStore.ts'
        ],
        critical_notes=[
            'Use theme.tokens.colors.accent for button highlight',
            'Add ARIA label for accessibility'
        ],
        test_requirements=[
            'Test toggle switches state correctly'
        ],
        token_budget=1500
    )

    print(AgentHandoff.format_handoff_summary(handoff))
    print("\n" + "="*60 + "\n")

    # Create example response
    response = AgentHandoff.create_response(
        task_id='haptic-toggle-001',
        agent_type='frontend',
        status='success',
        files_modified=['src/components/panels/SettingsPanel.tsx'],
        files_created=['src/components/panels/SettingsPanel.test.tsx'],
        interfaces={},
        exports=['SettingsPanel'],
        tests=['src/components/panels/SettingsPanel.test.tsx'],
        token_usage=1420,
        execution_time=0.8,
        warnings=['Consider adding keyboard shortcut for toggle']
    )

    print(AgentHandoff.format_response_summary(response))
