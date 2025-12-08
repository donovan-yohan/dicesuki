"""
Integration validation layer.
Runs cross-agent contract checks before deployment.
"""

import re
import ast
from pathlib import Path
from typing import List, Dict, Set, Tuple, Optional
from collections import defaultdict

from .contract_validators import (
    extract_store_contracts,
    validate_component_props,
    detect_race_conditions
)


class IntegrationValidator:
    """Validates contracts across agent outputs."""

    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)
        self.conflicts = []
        self.warnings = []

    def validate_type_safety(self, agent_interfaces: Dict[str, Dict[str, str]]) -> List[str]:
        """
        Check TypeScript interfaces match across agents.

        Args:
            agent_interfaces: {agent_name: {interface_name: definition}}

        Returns:
            List of conflicts found
        """
        conflicts = []

        # Group interfaces by name across all agents
        interface_map = defaultdict(dict)
        for agent, interfaces in agent_interfaces.items():
            for interface_name, definition in interfaces.items():
                interface_map[interface_name][agent] = self._normalize_interface(definition)

        # Check for conflicts
        for interface_name, agent_defs in interface_map.items():
            if len(agent_defs) > 1:
                # Multiple agents define this interface
                unique_defs = set(agent_defs.values())
                if len(unique_defs) > 1:
                    # Definitions don't match
                    conflict = f"❌ CRITICAL: Interface '{interface_name}' has conflicting definitions:"
                    for agent, defn in agent_defs.items():
                        conflict += f"\n  Agent '{agent}': {defn[:100]}..."
                    conflicts.append(conflict)

        return conflicts

    def _normalize_interface(self, definition: str) -> str:
        """Normalize interface definition for comparison (remove whitespace, comments)."""
        # Remove comments
        no_comments = re.sub(r'//.*$', '', definition, flags=re.MULTILINE)
        no_comments = re.sub(r'/\*.*?\*/', '', no_comments, flags=re.DOTALL)

        # Normalize whitespace
        normalized = ' '.join(no_comments.split())

        return normalized

    def validate_imports(self, file_path: Path) -> List[str]:
        """
        Check for circular dependencies and unresolved imports.
        Now supports index.ts/tsx resolution and TypeScript path aliases.

        Args:
            file_path: Path to file to validate

        Returns:
            List of conflicts found
        """
        conflicts = []

        if not file_path.exists():
            return [f"❌ File not found: {file_path}"]

        # Read file and extract imports
        content = file_path.read_text()
        imports = re.findall(r"import .* from ['\"](.+)['\"]", content)

        # Check if imports resolve
        for imp in imports:
            if imp.startswith('.'):
                # Relative import - resolve relative to file
                resolved = (file_path.parent / imp).resolve()

                # Try common extensions AND index files
                extensions = ['', '.ts', '.tsx', '.js', '.jsx']
                index_files = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']
                
                found = False
                
                # Try direct file with extensions
                for ext in extensions:
                    candidate = resolved.parent / (resolved.name + ext)
                    if candidate.exists():
                        found = True
                        break
                
                # Try index files if import points to directory
                if not found and resolved.is_dir():
                    for index_file in index_files:
                        candidate = Path(str(resolved) + index_file)
                        if candidate.exists():
                            found = True
                            break
                
                # Try index files by treating import as directory
                if not found:
                    for index_file in index_files:
                        candidate = Path(str(resolved) + index_file)
                        if candidate.exists():
                            found = True
                            break

                if not found:
                    conflicts.append(f"❌ HIGH: Unresolved import in {file_path.name}: {imp}")
            
            elif imp.startswith('@/'):
                # TypeScript path alias - check if it resolves
                # Assume @/ maps to src/
                alias_path = imp.replace('@/', 'src/')
                resolved = self.project_root / alias_path
                
                # Try common extensions AND index files
                extensions = ['', '.ts', '.tsx', '.js', '.jsx']
                index_files = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']
                
                found = False
                
                # Try direct file
                for ext in extensions:
                    candidate = resolved.parent / (resolved.name + ext)
                    if candidate.exists():
                        found = True
                        break
                
                # Try index files
                if not found:
                    for index_file in index_files:
                        candidate = Path(str(resolved) + index_file)
                        if candidate.exists():
                            found = True
                            break
                
                if not found:
                    conflicts.append(f"❌ HIGH: Unresolved path alias in {file_path.name}: {imp}")

        return conflicts

    def detect_circular_dependencies(self, file_paths: List[Path]) -> List[str]:
        """
        Detect circular dependencies using DFS.

        Args:
            file_paths: List of files to check

        Returns:
            List of circular dependency chains
        """
        conflicts = []

        # Build dependency graph
        graph = {}
        for file_path in file_paths:
            if not file_path.exists():
                continue

            content = file_path.read_text()
            imports = re.findall(r"import .* from ['\"](.+)['\"]", content)

            # Resolve imports to absolute paths
            resolved_imports = []
            for imp in imports:
                if imp.startswith('.'):
                    resolved = (file_path.parent / imp).resolve()
                    # Try common extensions
                    for ext in ['', '.ts', '.tsx']:
                        candidate = resolved.parent / (resolved.name + ext)
                        if candidate.exists():
                            resolved_imports.append(candidate)
                            break

            graph[file_path] = resolved_imports

        # DFS to detect cycles
        def dfs(node: Path, visited: Set[Path], path: List[Path]) -> Optional[List[Path]]:
            if node in path:
                # Cycle detected
                cycle_start = path.index(node)
                return path[cycle_start:] + [node]

            if node in visited:
                return None

            visited.add(node)
            path.append(node)

            for neighbor in graph.get(node, []):
                cycle = dfs(neighbor, visited, path[:])
                if cycle:
                    return cycle

            return None

        visited = set()
        for start_node in graph:
            cycle = dfs(start_node, visited, [])
            if cycle:
                cycle_str = " → ".join(p.name for p in cycle)
                conflicts.append(f"❌ HIGH: Circular dependency detected:\n  {cycle_str}")

        return conflicts

    def validate_test_coverage(self, modified_files: List[Path]) -> List[str]:
        """
        Check if modified files have corresponding tests.

        Args:
            modified_files: List of modified file paths

        Returns:
            List of warnings for missing tests
        """
        warnings = []

        for file_path in modified_files:
            # Skip test files themselves
            if 'test' in file_path.name:
                continue

            # Skip non-code files
            if file_path.suffix not in ['.ts', '.tsx', '.js', '.jsx']:
                continue

            # Check if test file exists
            test_extensions = ['.test.ts', '.test.tsx', '.test.js', '.test.jsx']
            test_exists = False

            for test_ext in test_extensions:
                test_file = file_path.with_suffix(test_ext)
                if test_file.exists():
                    test_exists = True
                    break

            if not test_exists:
                # Determine severity based on file type
                if 'hooks' in str(file_path):
                    severity = "CRITICAL"  # Hooks require 100% coverage
                elif 'lib' in str(file_path):
                    severity = "HIGH"      # Utilities should have high coverage
                else:
                    severity = "MEDIUM"    # Components can be tested later

                warnings.append(f"⚠️  {severity}: Missing test file for {file_path.name}")

        return warnings

    def validate_store_contracts(
        self,
        store_definitions: Dict[str, str],
        store_usages: Dict[Path, List[str]]
    ) -> List[str]:
        """
        Validate Zustand store property accesses.

        Args:
            store_definitions: {store_name: interface_definition}
            store_usages: {file_path: [accessed_properties]}

        Returns:
            List of conflicts for undefined properties
        """
        conflicts = []

        for store_name, definition in store_definitions.items():
            # Extract property names from interface
            # Simple regex - assumes format: "propertyName: type"
            properties = set(re.findall(r'(\w+):\s*\w+', definition))

            # Check usages
            for file_path, accessed_props in store_usages.items():
                for prop in accessed_props:
                    if prop not in properties:
                        conflicts.append(
                            f"❌ CRITICAL: Property '{prop}' accessed but not defined in {store_name}\n"
                            f"  File: {file_path.name}\n"
                            f"  Fix: Add '{prop}' to {store_name} interface"
                        )

        return conflicts

    def run_all_validations(self, agent_outputs: Dict[str, Dict]) -> Tuple[bool, str]:
        """
        Run all validation checks.

        Args:
            agent_outputs: {agent_name: output_dict}

        Returns:
            (success: bool, report: str)
        """
        self.conflicts = []
        self.warnings = []

        # 1. Type Safety Validation
        print("🔍 Running type safety validation...")
        interfaces = {}
        for agent, output in agent_outputs.items():
            if 'interfaces' in output:
                interfaces[agent] = output['interfaces']

        type_conflicts = self.validate_type_safety(interfaces)
        self.conflicts.extend(type_conflicts)

        # 2. Store Contract Validation (WAS MISSING!)
        print("🔍 Validating Zustand store contracts...")
        store_contracts = extract_store_contracts(self.project_root, agent_outputs)
        if store_contracts:
            store_conflicts = self.validate_store_contracts(
                store_contracts['definitions'],
                store_contracts['usages']
            )
            self.conflicts.extend(store_conflicts)

        # 3. API Contract Validation (component props) - WAS MISSING!
        print("🔍 Validating component API contracts...")
        api_conflicts = validate_component_props(self.project_root, agent_outputs)
        self.conflicts.extend(api_conflicts)

        # 4. Race Condition Detection (WAS MISSING!)
        print("🔍 Detecting potential race conditions...")
        race_conditions = detect_race_conditions(self.project_root, agent_outputs)
        self.warnings.extend(race_conditions)

        # 5. Import Validation
        print("🔍 Checking imports and dependencies...")
        all_files = []
        for output in agent_outputs.values():
            for file_path_str in output.get('filesModified', []) + output.get('filesCreated', []):
                file_path = self.project_root / file_path_str
                all_files.append(file_path)

        # Check circular dependencies
        circular_deps = self.detect_circular_dependencies(all_files)
        self.conflicts.extend(circular_deps)

        # Check unresolved imports
        for file_path in all_files:
            import_conflicts = self.validate_imports(file_path)
            self.conflicts.extend(import_conflicts)

        # 6. Test Coverage Validation
        print("🔍 Validating test coverage...")
        test_warnings = self.validate_test_coverage(all_files)
        self.warnings.extend(test_warnings)

        # Generate report
        report = self._generate_report(agent_outputs)

        # Determine success
        critical_count = len([c for c in self.conflicts if '❌ CRITICAL' in c])
        success = critical_count == 0

        return success, report

    def _generate_report(self, agent_outputs: Dict[str, Dict]) -> str:
        """Generate validation report."""
        agent_list = ', '.join(agent_outputs.keys())

        report = f"""
🔍 Validation Report
   Agents: {agent_list}

"""

        # Type Safety
        type_conflicts = [c for c in self.conflicts if 'Interface' in c and 'conflicting' in c]
        if type_conflicts:
            report += "❌ Type Safety: FAIL (CRITICAL)\n"
            for conflict in type_conflicts:
                report += f"   {conflict}\n\n"
        else:
            report += "✅ Type Safety: PASS\n"
            interface_count = sum(len(o.get('interfaces', {})) for o in agent_outputs.values())
            report += f"   - {interface_count} interfaces validated\n"
            report += "   - 0 conflicts detected\n\n"

        # Dependencies
        dep_conflicts = [c for c in self.conflicts if 'Circular' in c or 'Unresolved' in c]
        if dep_conflicts:
            report += "❌ Dependencies: FAIL (HIGH)\n"
            for conflict in dep_conflicts:
                report += f"   {conflict}\n\n"
        else:
            report += "✅ Dependencies: PASS\n"
            report += "   - No circular dependencies\n"
            report += "   - All imports resolve\n\n"

        # Test Coverage
        critical_test_warnings = [w for w in self.warnings if 'CRITICAL' in w]
        if critical_test_warnings:
            report += "❌ Test Coverage: FAIL (CRITICAL)\n"
            for warning in critical_test_warnings:
                report += f"   {warning}\n"
            report += "\n"
        elif self.warnings:
            report += "⚠️  Test Coverage: WARNING\n"
            for warning in self.warnings:
                report += f"   {warning}\n"
            report += "\n"
        else:
            report += "✅ Test Coverage: PASS\n"
            test_count = sum(len(o.get('tests', [])) for o in agent_outputs.values())
            report += f"   - {test_count} test files created/modified\n\n"

        # Summary
        critical_count = len([c for c in self.conflicts if '❌ CRITICAL' in c])
        high_count = len([c for c in self.conflicts if '❌ HIGH' in c])
        medium_count = len([w for w in self.warnings if '⚠️  MEDIUM' in w])

        if critical_count > 0:
            report += f"🚨 DEPLOYMENT BLOCKED\n"
            report += f"   - {critical_count} CRITICAL issue(s) must be resolved\n"
            if high_count > 0:
                report += f"   - {high_count} HIGH issue(s) should be resolved\n"
            if medium_count > 0:
                report += f"   - {medium_count} MEDIUM issue(s) can be deferred\n"
        elif high_count > 0:
            report += f"⚠️  DEPLOYMENT WARNING\n"
            report += f"   - {high_count} HIGH issue(s) should be resolved\n"
            report += f"   - Proceed with caution\n"
        else:
            report += "✅ DEPLOYMENT APPROVED\n"
            report += "   - All validations passed\n"

        return report

    def get_conflicts(self) -> List[str]:
        """Return detected conflicts."""
        return self.conflicts

    def get_warnings(self) -> List[str]:
        """Return detected warnings."""
        return self.warnings


# Example usage
if __name__ == '__main__':
    # Example validation
    validator = IntegrationValidator(Path.cwd())

    # Mock agent outputs
    agent_outputs = {
        'frontend': {
            'filesModified': ['src/components/panels/SettingsPanel.tsx'],
            'filesCreated': ['src/components/panels/SettingsPanel.test.tsx'],
            'interfaces': {
                'HapticToggleProps': 'interface HapticToggleProps { enabled: boolean; onChange: (enabled: boolean) => void }'
            },
            'tests': ['src/components/panels/SettingsPanel.test.tsx']
        },
        'state': {
            'filesModified': ['src/store/useUIStore.ts'],
            'interfaces': {
                'UIStore': 'interface UIStore { hapticEnabled: boolean; setHapticEnabled: (enabled: boolean) => void }'
            },
            'tests': []
        }
    }

    success, report = validator.run_all_validations(agent_outputs)
    print(report)
    print(f"\nValidation {'PASSED' if success else 'FAILED'}")
